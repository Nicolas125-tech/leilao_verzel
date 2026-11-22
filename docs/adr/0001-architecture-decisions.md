# 0001. Decisoes de Arquitetura da Casa de Leiloes

Status: Aceito (Atualizado em 2026-11-21)
Data: 2026-10-22

## Contexto

O sistema consiste em uma plataforma de leiloes online em tempo real onde leiloeiros catalogam obras de arte a partir de uma API publica e licitantes disputam cada lote com saldo de carteira. O dominio exige consistencia financeira estrita sob concorrencia de lances, resiliencia contra instabilidades da fonte externa de dados, atualizacao instantanea na interface sem recarregamento de pagina e um mecanismo publico de auditoria capaz de detectar adulteracoes diretas no banco de dados relacional.

## Decisoes

### 1. Stack de Back-End e Persistencia Relacional

Optamos por Python 3.12+ com FastAPI, SQLAlchemy 2.0 (modo assincrono/sincrono controlado), Alembic para versionamento de schema e PostgreSQL 16 (`leilao_verzel`). O PostgreSQL foi escolhido pela maturidade no controle de isolamento transacional e suporte nativo a bloqueio pessimista de linha (`SELECT ... FOR UPDATE`), requisito essencial para evitar condicoes de corrida na disputa de lances e na reserva de saldo.

### 2. Representacao Monetaria em Centavos e Bloqueio Pessimista

Valores financeiros nunca utilizam ponto flutuante (`float`). Todos os saldos, lances iniciais, incrementos e valores de arremate sao armazenados e processados como inteiros em centavos (`BigInteger` no PostgreSQL e `int` no Python), protegidos por tres `CheckConstraint` na tabela `wallets` (`total >= 0`, `committed >= 0`, `committed <= total`).

Durante o processamento de um lance (`place_bid`), a transacao adquire lock exclusivo na linha do lote (`SELECT ... FOR UPDATE`) e nas carteiras dos usuarios envolvidos em ordem deterministica de `user_id` para prevenir deadlocks. Sob PostgreSQL nao ha trava em memoria (`_lot_locks` e usada apenas quando o dialeto da sessao e `sqlite` em testes locais sem Postgres). Na mesma transacao:
1. Verifica-se a integridade criptografica do lote e da cadeia existente; em caso de violacao, o lance e bloqueado com `HTTP 409`.
2. Valida-se a janela temporal do lote, o valor minimo exigido e se o licitante ja nao e o lider atual (`HTTP 400`).
3. Verifica-se se o saldo disponivel (`total_balance_cents - committed_balance_cents`) comporta o novo lance.
4. Caso exista um lider anterior, o valor antes retido no `committed_balance_cents` dele e liberado imediatamente (`BID_RELEASE`), voltando para o seu saldo disponivel.
5. O valor do novo lance passa a integrar o `committed_balance_cents` do novo lider (`BID_HOLD`) e o lance e persistido com unicidade garantida em banco por `(lot_id, sequence_number)` (`uq_bid_lot_sequence`).

### 3. Desacoplamento e Resiliencia da API Externa

Para o catalogo de obras, integramos a API Open Access do Cleveland Museum of Art (`openaccess-api.clevelandart.org`). Como APIs publicas estao sujeitas a indisponibilidade ou lentidao, o servico `catalog.py` opera em camadas:
1. Leitura de cache fresco na tabela `catalog_cache` do PostgreSQL (TTL de 10 minutos).
2. Requisicao HTTP com timeout de 4 segundos, ate 3 tentativas com backoff + jitter e protecao por `CatalogCircuitBreaker` (abre por 60s apos 3 falhas consecutivas).
3. Leitura de cache expirado (*stale*) em `catalog_cache` caso a API falhe ou o disjuntor esteja aberto.
4. Fallback local curado em `LOCAL_FALLBACK_ARTWORKS` (6 obras com SVG em `frontend/public/artworks/`).

Ao publicar um lote, o back-end persiste uma copia completa dos dados da obra diretamente na tabela `lots`, tornando vitrine, disputa, liquidacao e auditoria independentes da API externa.

### 4. Prorrogacao Anti-Sniping e Liquidacao Hibrida (Worker + Lazy Sync)

Lances validos recebidos nos ultimos 120 segundos antes do `end_time` prorrogam o encerramento do lote em +120 segundos a partir do termino vigente (preservando os segundos residuais) e recalculam `lots.integrity_seal`.

A liquidacao ocorre de forma atomica sob `SELECT ... FOR UPDATE` e `verify_lot_integrity`:
1. Um worker em background (`settlement_background_worker` em `main.py`) varre a cada 15 segundos lotes expirados (`status == "LIVE"` e `end_time <= utc_now()`) usando `with_for_update(skip_locked=True)`.
2. Em paralelo, consultas e transicoes via `sync_lot_temporal_state` sincronizam lotes vencidos imediatamente se a requisicao chegar entre ciclos do worker.
3. Se um lote apresentar adulteracao criptografica, `settle_lot` levanta `LotIntegrityError` antes de debitar/creditar carteiras ou emitir recibo; o worker e `sync_lot_temporal_state` registram `logger.critical` sem interromper a disponibilidade dos demais lotes nem a consulta publica de auditoria.

### 5. Cadeia HMAC-SHA256 Persistida, Selo do Lote e Bloqueio Fail-Closed

Para impedir que alguem com acesso ao banco altere um lance e recalcule hashes localmente (ou remova o ultimo lance, ou altere `auctioneer_id`/`end_time` para desviar a liquidacao), a integridade e ancorada em chave secreta fora do banco (`HMAC_SECRET_KEY`, obrigatoriamente nao-padrao em `ENVIRONMENT=production`):

1. A cadeia parte de `GENESIS_HASH = "0" * 64`.
2. Cada lance persiste `previous_hash`, `current_hash` (HMAC-SHA256 com prefixo de dominio `bid-hash:v2|`) e `node_signature` (HMAC-SHA256 com prefixo `bid-sig:v2|` cobrindo tambem `current_hash`).
3. A tabela `lots` persiste `integrity_seal` (HMAC-SHA256 com prefixo `lot-seal:v2|`) cobrindo `lot_id`, `bid_count`, `head_hash`, `auctioneer_id`, `end_time`, `leader_user_id` e `current_bid_cents`.
4. Na tabela `settlements`, `receipt_signature` (HMAC-SHA256 com prefixo `receipt:v2|`) amarra inclusive `final_bid_hash`.
5. Toda verificacao usa `hmac.compare_digest` em tempo constante. Lotes legados sao migrados pela revisao Alembic `0003_hmac_audit_seal_and_constraints` (`rechain_and_seal_legacy_data`).

### 6. Privacidade de Licitantes e Restricao de Cadastro Publico

Dados pessoais como nome completo, e-mail e `UUID` real de usuarios nunca trafegam nas rotas publicas (`GET /lots`, `GET /lots/{id}`, `/ws/lots/{id}`, `/lots/{id}/audit` e `/receipts/{code}`).
- `LotResponse`, `BidResponse`, `CertificateSummaryResponse` e eventos `NEW_BID` / `LOT_SETTLED` no WebSocket nao incluem `user_id`, `leader_user_id`, `auctioneer_id`, `winner_user_id` nem `auctioneer_user_id`.
- As rotas publicas de lotes usam autenticacao opcional (`get_optional_current_user`) para devolver os flags `is_own_bid`, `is_user_leading` e `has_user_participated` ao usuario autenticado, enquanto a auditoria usa `LICITANTE-XXXXXXXXXX` derivado via HMAC.
- O endpoint publico `POST /api/v1/auth/register` aceita exclusivamente o papel `BIDDER` (retornando `HTTP 403` para `AUCTIONEER`). Contas de leiloeiro sao provisionadas via seed/banco.
