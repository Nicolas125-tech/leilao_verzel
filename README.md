# Casa de Leilões Verzel

![Python](https://img.shields.io/badge/Python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-Async-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)
![React](https://img.shields.io/badge/React-18%20%2B%20TS-61dafb)
![Tests](https://img.shields.io/badge/Testes-80%20Passing-brightgreen)

- **Aplicação em produção (Frontend):** https://leilao-verzel.vercel.app
- **Documentação interativa da API (Swagger/OpenAPI):** https://leilao-verzel.onrender.com/docs

Este repositório contém a minha implementação para o desafio técnico **Elite Dev na Verzel** (vaga de Desenvolvedor Full Stack Júnior). O objetivo do projeto é construir uma casa de leilões online completa em que um leiloeiro cataloga obras de arte reais a partir de uma API pública, abre lotes com tempo programado e acompanha o faturamento, enquanto os licitantes depositam saldo em carteira, disputam obras ao vivo via WebSockets e recebem comprovantes verificáveis de arremate.

Abaixo eu conto em detalhes como pensei a arquitetura desde a leitura do enunciado, como cada função do banco de dados, do backend e do frontend opera por baixo dos panos, como rodar e testar tudo localmente e, no final, um relato aberto sobre como utilizei ferramentas de IA durante o desenvolvimento e o que precisei intervir, corrigir e projetar na mão.

---

## Sumário

1. [Linha de raciocínio: do PDF para a arquitetura](#1-linha-de-raciocínio-do-pdf-para-a-arquitetura)
2. [Análise completa do Banco de Dados (PostgreSQL)](#2-análise-completa-do-banco-de-dados-postgresql)
3. [Análise completa do Backend (FastAPI + SQLAlchemy Async)](#3-análise-completa-do-backend-fastapi--sqlalchemy-async)
4. [Análise completa do Frontend (React 18 + TypeScript + Tailwind)](#4-análise-completa-do-frontend-react-18--typescript--tailwind)
5. [Cobertura de requisitos do desafio (Obrigatórios e Opcionais)](#5-cobertura-de-requisitos-do-desafio-obrigatórios-e-opcionais)
6. [Como rodar o projeto (Docker Compose e Local)](#6-como-rodar-o-projeto-docker-compose-e-local)
7. [Contas pré-configuradas (Seed) e roteiro de testes](#7-contas-pré-configuradas-seed-e-roteiro-de-testes)
8. [Como testar a detecção de adulteração no banco (SQL Tampering)](#8-como-testar-a-detecção-de-adulteração-no-banco-sql-tampering)
9. [Suíte de testes automatizados (80 testes)](#9-suíte-de-testes-automatizados-80-testes)
10. [Onde e como usei IA (Relato transparente para o envio da Verzel)](#10-onde-e-como-usei-ia-relato-transparente-para-o-envio-da-verzel)

---

## 1. Linha de raciocínio: do PDF para a arquitetura

Quando abri o documento do desafio da Verzel, antes de criar qualquer pasta ou componente de tela, separei o problema em cinco dores reais que derrubam sistemas de leilão quando saem do papel:

1. **Arredondamento de dinheiro e saldo furado:** Se você guarda dinheiro em `float` no Python ou `number` decimal solto, mais cedo ou mais tarde `0.1 + 0.2` vira `0.30000000000000004` e a validação de incremento mínimo falha por causa de um centésimo de centavo. Por isso, decidi logo no início que 100% dos valores financeiros no banco (`BIGINT`), no backend (`int`) e nos payloads JSON trafegariam em **centavos inteiros** (`amount_cents`). A conversão para `R$ 1.250,00` só existe na última linha do frontend, na hora de pintar o texto na tela.
2. **Dois licitantes clicando ao mesmo tempo (Condição de Corrida):** Em um leilão ao vivo, se dois usuários mandam um lance no mesmo milissegundo e a API apenas faz um `SELECT` normal, valida o valor em memória e depois dá `UPDATE`, os dois lances passam, o saldo comprometido do líder anterior fica preso para sempre e o lote fica em estado inconsistente. A solução foi usar bloqueio pessimista de linha no PostgreSQL (`SELECT ... FOR UPDATE`) tanto no lote quanto nas carteiras envolvidas, ordenando os IDs das carteiras antes do lock para impedir deadlocks cruzados.
3. **Reserva de saldo sem duplicar bloqueio quando o líder cobre a si mesmo:** O enunciado proíbe que o líder atual dê um lance em cima de si mesmo (`409 Conflict`). E quando outro licitante supera o líder, a transação precisa fazer duas coisas juntas: liberar o `committed_balance_cents` do antigo líder (gerando um registro `BID_RELEASE` no extrato) e travar o valor do novo líder (`BID_HOLD`), tudo na mesma transação atômica.
4. **Dependência de API pública de terceiro:** O desafio pede para buscar itens de uma API pública. No começo testei a API do Art Institute of Chicago, mas ela frequentemente devolvia `403 Forbidden` por bloqueio da Cloudflare em IPs de data center (como o Render). Mudei a fonte primária para a API Open Access do **Cleveland Museum of Art** (licença CC0) e desenhei uma proteção em 4 camadas com Circuit Breaker, cache em memória, snapshot imutável salvo no lote e um acervo local em SVG para que o leiloeiro nunca fique travado se a internet ou a API externa cair.
5. **Histórico à prova de adulteração e LGPD:** O enunciado pergunta diretamente: *"se alguém alterar ou remover um lance direto no banco de dados, o sistema consegue detectar?"*. Uma tabela comum com `created_at` não detecta nada se alguém rodar um `UPDATE` ou `DELETE` manual. Implementei uma cadeia de hashes SHA-256 estilo blockchain para cada lote, partindo de um `GENESIS_HASH = "0" * 64`, somada a uma assinatura HMAC por nó (`node_signature`) e pseudonimização unidirecional do ID do licitante (`LICITANTE-XXXXXXXXXX`). Se um DBA alterar 1 centavo no lance #2 ou apagar uma linha, a cadeia inteira daquele ponto em diante acusa invalidez na hora.


Fluxo de trabalho no GitHub, CI/CD e padrão de branches
Para manter o repositório organizado e evitar que código quebrado chegue em produção, estruturei o fluxo de trabalho com branches de estágio, commits atômicos e integração contínua no GitHub Actions (.github/workflows/ci.yml).

1. Estratégia de branches e commits
Separei o histórico de desenvolvimento por escopo antes de consolidar o código na linha de produção:

feat/* e fabrica/*: branches de trabalho para isolar funcionalidades específicas, como o motor de lances, a cadeia de auditoria SHA-256, o Circuit Breaker do catálogo e os ajustes de interface.

estagio (staging): branch intermediária de homologação para validar a integração completa entre frontend, backend e banco de dados antes da entrega final.

main: branch principal conectada diretamente aos ambientes de produção na Vercel (Frontend) e no Render (Backend + PostgreSQL).

No histórico de commits, segui o padrão Conventional Commits (feat, fix, refactor, perf, test, docs) com mensagens descritivas em português. Separei alterações de regra de negócio, ajustes visuais de UI/UX e documentação em commits independentes para facilitar o code review e um eventual git revert.

2. Pipeline de integração contínua (GitHub Actions)
Configurei o workflow .github/workflows/ci.yml (CI Pipeline) para disparar a cada push ou pull_request nas branches main, estagio, staging, fabrica e feat/*. O pipeline roda dois jobs em paralelo em máquinas ubuntu-latest:

Job backend (Backend Tests): sobe um container de serviço real do PostgreSQL 16 (postgres:16-alpine) na porta 5432 e aguarda o healthcheck nativo (pg_isready) antes de iniciar os passos da aplicação. Depois, configura o Python 3.12 com cache de dependências do pip baseado no backend/requirements.txt e injeta as variáveis de ambiente de teste (DATABASE_URL assíncrona com asyncpg, DATABASE_URL_SYNC com psycopg2, JWT_SECRET_KEY e HMAC_SECRET_KEY). Ao final, executa a suíte de testes automatizados (python -m pytest backend/tests -v), que valida concorrência de lances, trava pessimista (SELECT ... FOR UPDATE), anti-sniping, liquidação financeira, resiliência do catálogo externo e detecção de adulteração via SQL direto na cadeia de hashes.

Job frontend (Frontend Tests & Build): configura o Node.js 22 com cache baseado no frontend/package-lock.json e instala os pacotes via npm --prefix frontend ci. Na sequência, roda os testes unitários com Vitest (npm --prefix frontend test) para validar conversões monetárias em centavos, cronômetro regressivo, filtros de disputa e estado das notificações. Por último, faz a checagem estrita de tipos do TypeScript (tsc -b) e o build de produção do Vite (npm --prefix frontend run build) para impedir que quebras de tipagem ou importação cheguem ao deploy.

3. Entrega contínua (deploy em produção)
Com o pipeline verde no GitHub Actions, o deploy acontece em duas frentes. Na Vercel, a plataforma detecta a atualização na branch principal, executa o build estático do React/Vite com as regras de roteamento SPA (vercel.json) e publica a interface em [https://leilao-verzel.vercel.app](https://leilao-verzel.vercel.app). No Render, o serviço da API FastAPI é reconstruído, sincroniza as tabelas no PostgreSQL de produção (incluindo a tabela catalog_cache e as constraints financeiras) durante o startup da aplicação e disponibiliza a API e o Swagger em [https://leilao-verzel.onrender.com/docs](https://leilao-verzel.onrender.com/docs)

---

## 2. Análise completa do Banco de Dados (PostgreSQL)

O banco roda em PostgreSQL 16 e toda a estrutura é versionada via Alembic (`backend/alembic/versions/`). Todos os modelos herdam de `Base` e `TimestampMixin` (`backend/app/models/base.py`), onde a função `utc_now()` gera timestamps sempre em UTC (`datetime.now(timezone.utc)`) gravados em colunas `DateTime(timezone=True)` (`TIMESTAMPTZ`).

### 2.1. Tabela `users` (`backend/app/models/user.py`)
Guarda tanto os leiloeiros (`AUCTIONEER`) quanto os compradores (`BIDDER`).
- **Colunas:** `id` (`UUID`, PK), `name` (`String(150)`), `email` (`String(255)`, único e indexado), `password_hash` (`String(255)` com bcrypt), `role` (`String(20)`), `public_code` (`String(20)`, único, ex: `LIC-8F9A` ou `LEI-4B1C`), `masked_name` (`String(150)`, ex: `LIC-8F9A (N***s B.)`), `created_at` e `updated_at`.
- **Relacionamentos:** 1:1 com `Wallet`, 1:N com `Lot` (como leiloeiro criador) e 1:N com `Bid` (lances enviados).

### 2.2. Tabela `wallets` (`backend/app/models/wallet.py`)
Representa a carteira financeira de cada usuário.
- **Colunas:** `id` (`UUID`, PK), `user_id` (`UUID`, FK única para `users.id` com `CASCADE`), `total_balance_cents` (`BigInteger`, padrão `0`) e `committed_balance_cents` (`BigInteger`, padrão `0`).
- **Constraints de integridade no banco (`__table_args__`):**
  - `ck_wallet_total_positive`: `total_balance_cents >= 0`
  - `ck_wallet_committed_positive`: `committed_balance_cents >= 0`
  - `ck_wallet_balance_consistency`: `committed_balance_cents <= total_balance_cents`
  Essas três constraints garantem que, mesmo se houvesse um bug na aplicação, o próprio PostgreSQL abortaria qualquer operação que deixasse o saldo negativo ou o valor comprometido maior que o saldo total.
- **Propriedade calculada `available_balance_cents`:** Retorna `total_balance_cents - committed_balance_cents`. É esse valor livre que o motor de lances consulta antes de aceitar uma oferta.

### 2.3. Tabela `wallet_transactions` (`backend/app/models/wallet.py`)
Funciona como o livro-razão (extrato contábil) de cada carteira. Nenhuma alteração de saldo acontece sem gerar uma linha aqui.
- **Colunas:** `id` (`UUID`, PK), `wallet_id` (`FK wallets.id`), `user_id` (`FK users.id`), `lot_id` (`FK lots.id`, opcional com `SET NULL`), `type` (`String(30)`), `amount_cents` (`BigInteger`), `balance_after_cents` (`BigInteger`), `committed_after_cents` (`BigInteger`), `description` (`String(255)`), `created_at` e `updated_at`.
- **Tipos de lançamento registrados:**
  - `DEPOSIT`: Recarga de saldo simulada feita pelo licitante.
  - `BID_HOLD`: Bloqueio de saldo quando o licitante assume a liderança de um lote.
  - `BID_RELEASE`: Desbloqueio automático de saldo quando outro licitante cobre a oferta anterior.
  - `SETTLEMENT_DEBIT`: Desconto definitivo do saldo total e comprometido do vencedor no encerramento do lote.
  - `SETTLEMENT_CREDIT`: Crédito líquido do valor do arremate na carteira do leiloeiro.
  - `CANCEL_REFUND`: Estorno automático do saldo comprometido do líder caso o leiloeiro cancele o lote.

### 2.4. Tabela `lots` (`backend/app/models/lot.py`)
Armazena o lote publicado, o snapshot completo da obra de arte (para não depender da API externa depois de criado) e o ponteiro do topo da cadeia criptográfica.
- **Colunas:** `id` (`UUID`, PK), `lot_number` (`Integer`, único e indexado, ex: `101`, `102`), `auctioneer_id` (`FK users.id`), `external_artwork_id` (`String(100)`), `title` (`String(255)`), `artist` (`String(255)`), `date_display` (`String(100)`), `medium_display` (`String(255)`), `image_url` (`Text`), `attributes_json` (`JSON`), `starting_bid_cents` (`BigInteger`), `min_increment_cents` (`BigInteger`), `current_bid_cents` (`BigInteger`, anulável), `leader_user_id` (`FK users.id`, anulável), `leader_masked_name` (`String(150)`, anulável), `start_time` (`TIMESTAMPTZ`), `end_time` (`TIMESTAMPTZ`), `status` (`String(20)`: `SCHEDULED`, `LIVE`, `ENDED`, `CANCELLED`), `extension_count` (`Integer`, conta quantas prorrogações de anti-sniping ocorreram), `bid_count` (`Integer`), `head_hash` (`String(64)`, inicia com `0000...0000`), `settled_at` (`TIMESTAMPTZ`, anulável) e `cancelled_at` (`TIMESTAMPTZ`, anulável).
- **Constraints no banco:**
  - `ck_lot_starting_bid_positive`: `starting_bid_cents > 0`
  - `ck_lot_min_increment_positive`: `min_increment_cents > 0`

### 2.5. Tabela `bids` (`backend/app/models/lot.py`)
Guarda cada lance aceito como um elo numerado e encadeado criptograficamente.
- **Colunas:** `id` (`UUID`, PK), `lot_id` (`FK lots.id` com `CASCADE`), `user_id` (`FK users.id`), `bidder_masked_name` (`String(150)`), `sequence_number` (`Integer`), `amount_cents` (`BigInteger`), `previous_hash` (`String(64)`), `current_hash` (`String(64)`, único), `extension_triggered` (`Boolean`), `created_at` e `updated_at`.
- **Constraint de unicidade:** `uq_bid_lot_sequence` (`UniqueConstraint("lot_id", "sequence_number")`). Isso impede no nível do SGBD que dois lances recebam o mesmo número de sequência dentro de um lote.

### 2.6. Tabela `winning_certificates` (`backend/app/models/lot.py`)
Armazena o comprovante público de arremate emitido quando um lote com lances é liquidado.
- **Colunas:** `id` (`UUID`, PK), `receipt_code` (`String(40)`, único e indexado, ex: `CERT-2026-0102-A1B2C3`), `lot_id` (`FK lots.id`, único), `winner_user_id` (`FK users.id`), `winner_masked_name` (`String(150)`), `final_amount_cents` (`BigInteger`), `final_bid_hash` (`String(64)`), `receipt_signature` (`String(64)`, assinatura HMAC-SHA256) e `settled_at` (`TIMESTAMPTZ`).

---

## 3. Análise completa do Backend (FastAPI + SQLAlchemy Async)

O backend foi organizado separando infraestrutura e segurança (`app/core/`), modelos (`app/models/`), contratos de entrada e saída (`app/schemas/`), regras de negócio puras (`app/services/`) e rotas HTTP/WebSocket (`app/api/`). Abaixo detalho todas as funções de cada módulo.

### 3.1. Criptografia, Cadeia de Hashes e Pseudonimização LGPD (`backend/app/core/crypto.py`)
Este módulo concentra toda a matemática de integridade do leilão:
- `GENESIS_HASH`: Constante `"0" * 64` usada como `previous_hash` do lance #1 e como `head_hash` inicial de todo lote recém-criado.
- `format_utc_iso(dt: datetime) -> str`: Normaliza qualquer `datetime` para UTC e formata no padrão canônico ISO-8601 com precisão fixa de microssegundos (`%Y-%m-%dT%H:%M:%S.%fZ`). Isso é essencial porque, ao recalcular o hash durante a auditoria, 1 microssegundo ou fuso diferente mudaria o SHA-256 inteiro.
- `generate_bidder_pseudonym(user_id: str | UUID, secret: str | None) -> str`: Aplica `HMAC-SHA256` sobre o `UUID` do usuário usando a chave secreta do servidor, pega os primeiros 10 caracteres hexadecimais em caixa alta e retorna `LICITANTE-XXXXXXXXXX`. Assim, a auditoria pública nunca expõe e-mail, nome civil ou UUID real do comprador (conformidade com a LGPD), mas mantém determinismo para que o mesmo licitante tenha o mesmo pseudônimo criptográfico na trilha.
- `compute_bid_hash(...) -> str`: Monta a string canônica `f"{lot_id}|{sequence_number}|{bidder_pseudonym}|{amount_cents}|{created_at_iso}|{previous_hash}"` e retorna o digest `SHA-256` de 64 caracteres.
- `compute_node_signature(...) -> str`: Assina os metadados do nó com `HMAC-SHA256` usando `SECRET_KEY`, gerando o campo `node_signature` exibido na auditoria.
- `verify_bid_chain(...) -> dict`: Percorre a lista de lances do lote do índice 1 até o fim. Em cada elo:
  1. Confere se `sequence_number` é estritamente sequencial (`1, 2, 3...`), detectando se alguma linha intermediária foi deletada.
  2. Confere se `bid.previous_hash` bate exatamente com o `expected_prev_hash` (que começa em `GENESIS_HASH` e passa a ser o `recomputed_hash` do nó anterior).
  3. Recalcula o `SHA-256` do nó com os dados atuais do banco e compara em tempo constante (`hmac.compare_digest`) com o `bid.current_hash` salvo.
  4. Se qualquer verificação falhar no nó `k`, define `is_intact = False`, crava `tampered_at_sequence = k` (no primeiro elo corrompido) e marca o nó `k` e todos os nós seguintes (`k+1, k+2...`) com `status = "invalid"` e `is_valid = False` por efeito cascata.
  5. No final, ainda compara o último hash da cadeia com `lot.head_hash` e o total de linhas com `lot.bid_count`, pegando até mesmo a exclusão do último lance da tabela.
- `generate_receipt_signature(...)` e `verify_receipt_signature(...)`: Geram e validam em tempo constante a assinatura `HMAC-SHA256` dos comprovantes públicos de arremate.

### 3.2. Privacidade, Autenticação JWT e Rate Limiting (`backend/app/core/`)
- **Privacidade (`backend/app/core/privacy.py`):**
  - `generate_public_code(user_id, role)`: Cria o identificador curto (`LEI-XXXX` para leiloeiro, `LIC-XXXX` para licitante).
  - `mask_name(full_name, public_code)`: Mascara o nome civil preservando apenas a primeira e última letra do prenome e a inicial do sobrenome, como `LIC-3DAD (N***s B.)`.
- **Segurança (`backend/app/core/security.py`):**
  - `hash_password(password)` e `verify_password(plain_password, hashed_password)`: Geram e verificam hashes `bcrypt` com salt aleatório.
  - `create_access_token(user_id, role, expires_delta)` e `decode_access_token(token)`: Assinam e validam tokens JWT (`HS256`) contendo `sub` (UUID do usuário), `role`, `iat` e `exp`.
- **Rate Limiter de Janela Deslizante (`backend/app/core/rate_limit.py`):**
  - `RateLimiter._clean_and_get(key, window_seconds)`: Limpa timestamps vencidos usando `time.monotonic()`.
  - `RateLimiter.check(...)` e `check_limit_exceeded(...)`: Bloqueiam excesso de requisições devolvendo `HTTP 429 Too Many Requests` com cabeçalho `Retry-After` calculado em segundos. Usado para limitar tentativas falhas de login (`10 tentativas a cada 15 min` por par IP+email) e envio de lances (`30 lances por minuto` por usuário).
  - `get_client_ip(request)`: Extrai o IP real respeitando cabeçalhos de proxy reverso (`CF-Connecting-IP` e `X-Forwarded-For`).
- **Dependências de Autorização (`backend/app/api/deps.py`):**
  - `get_current_user`: Extrai o Bearer token do header `Authorization`, valida o JWT e carrega o `User` ativo no banco.
  - `require_role(allowed_roles)`: Closure que cria os guardas `require_bidder` (exclusivo para `BIDDER`) e `require_auctioneer` (exclusivo para `AUCTIONEER`).

### 3.3. Motor de Lances, Concorrência e Anti-Sniping (`backend/app/services/bidding.py`)
A função `place_bid(db, bidder, lot_id, payload)` é o coração transacional da aplicação:
1. **Validação de perfil:** Garante que apenas contas `BIDDER` enviem lances (`403 Forbidden`).
2. **Sincronização temporal prévia:** Se o lote já venceu pelo relógio antes da leitura com lock, chama `settle_lot` imediatamente e rejeita o lance (`409 Conflict`).
3. **Lock pessimista do lote:** Executa `SELECT ... FROM lots WHERE id = :lot_id FOR UPDATE`. Qualquer outro lance simultâneo para o mesmo lote aguarda na fila do PostgreSQL até esta transação terminar.
4. **Transição automática `SCHEDULED -> LIVE`:** Se o lote estava agendado mas `now_utc >= start_time`, promove o status para `LIVE` dentro da transação.
5. **Regra de não cobrir a si mesmo:** Se `lot.leader_user_id == bidder.id`, aborta com `409 Conflict` explicando que o usuário já detém a maior oferta.
6. **Validação do lance mínimo:** Se for o primeiro lance do lote (`current_bid_cents is None`), exige `amount_cents >= starting_bid_cents`. Se já houver lances, exige `amount_cents >= current_bid_cents + min_increment_cents`. Caso contrário, retorna `422 Unprocessable Entity` informando o valor mínimo exato em reais.
7. **Lock ordenado de carteiras (Prevenção de Deadlock):** Descobre os `user_id` que precisam ter a carteira bloqueada (o licitante atual e, se existir, o líder anterior que está sendo superado). Ordena a lista com `sorted(..., key=lambda uid: str(uid))` e executa `SELECT ... FROM wallets WHERE user_id IN (...) FOR UPDATE`. Ordenar os UUIDs garante que duas transações concorrentes nunca travem a Carteira A esperando a B enquanto a outra trava a B esperando a A.
8. **Checagem de saldo livre:** Verifica se `bidder_wallet.available_balance_cents >= payload.amount_cents`. Se faltar saldo, retorna `422 Unprocessable Entity` mostrando quanto há disponível e quanto foi tentado.
9. **Troca atômica de reserva (Escrow):**
   - Se havia um líder anterior (`previous_leader_id`), subtrai `previous_amount` do `committed_balance_cents` dele e insere uma `WalletTransaction` do tipo `BID_RELEASE`.
   - Soma `payload.amount_cents` no `committed_balance_cents` do novo líder e insere uma `WalletTransaction` do tipo `BID_HOLD`.
10. **Regra de Anti-Sniping (+120 segundos):** Calcula `remaining_seconds = (end_utc - now_utc).total_seconds()`. Se `0 < remaining_seconds <= 120` (janela configurada em `ANTI_SNIPING_WINDOW_SECONDS`), soma `120 segundos` (`ANTI_SNIPING_EXTENSION_SECONDS`) ao `lot.end_time` vigente, incrementa `lot.extension_count` e marca `extension_triggered = True` no lance. Somar ao `end_time` vigente (em vez de `now + 120s`) preserva os segundos que ainda restavam no relógio.
11. **Construção do elo criptográfico:** Incrementa `sequence_number = lot.bid_count + 1`, gera o pseudônimo HMAC do licitante com `generate_bidder_pseudonym`, calcula `current_hash` via `compute_bid_hash` encadeado ao `lot.head_hash` anterior, salva o `Bid` e atualiza `lot.head_hash = current_hash`.
12. **Broadcast em tempo real (Pós-commit):** Após o `await db.commit()`, dispara via `ws_manager`:
    - Evento `NEW_BID` para todos os espectadores conectados na sala do lote (`/ws/lots/{lot_id}`).
    - Se houve anti-sniping, evento `LOT_EXTENDED` para a sala e para os participantes.
    - Se havia um líder anterior que foi superado, envia uma notificação privada `OUTBID` pelo canal autenticado `/ws/notifications` diretamente para ele.

### 3.4. Liquidação Financeira e Comprovantes Verificáveis (`backend/app/services/settlement.py`)
- `settle_lot(db, lot)`:
  - Adquire `SELECT ... FOR UPDATE` no lote e verifica se já não foi liquidado ou cancelado (garantindo idempotência).
  - **Caso 1: Lote encerrado sem lances (`bid_count == 0`):** Muda `status = "ENDED"`, preenche `settled_at`, faz commit e avisa a sala via WebSocket (`LOT_SETTLED` com `winner_masked_name = None`).
  - **Caso 2: Lote encerrado com vencedor:** Faz lock ordenado das carteiras do vencedor e do leiloeiro (`SELECT ... FOR UPDATE`). Deduz `final_amount` tanto de `total_balance_cents` quanto de `committed_balance_cents` do vencedor (gerando transação `SETTLEMENT_DEBIT`) e soma `final_amount` no `total_balance_cents` do leiloeiro (gerando transação `SETTLEMENT_CREDIT`). Em seguida, gera um código único `CERT-YYYY-NNNN-XXXXXX`, calcula a assinatura `HMAC-SHA256` (`generate_receipt_signature`) amarrada ao `final_bid_hash` e cria o registro em `winning_certificates`, tudo no mesmo commit.
- `settle_expired_lots(db)`: Busca todos os lotes com `status == "LIVE"` e `end_time <= utc_now()` usando `.with_for_update(skip_locked=True)` e liquida cada um. Essa função é chamada a cada 15 segundos pelo `settlement_background_worker` registrado no `lifespan` do FastAPI (`backend/app/main.py`).
- `get_public_receipt(db, receipt_code)`: Busca o comprovante pelo código, recalcula a assinatura HMAC em tempo real com `verify_receipt_signature` e devolve os dados da obra, do arremate e a flag `is_signature_valid`.
- `get_bidder_bids_and_wins(db, bidder)`: Retorna todos os lotes em que o comprador deu lance, indicando o maior lance dele, se está vencendo ou se arrematou, além da lista de certificados ganhos.
- `get_auctioneer_dashboard(db, auctioneer)`: Sincroniza o estado temporal dos lotes do leiloeiro, calcula o faturamento bruto liquidado (`total_revenue_cents`), o total de lotes arrematados e os lotes ativos.

### 3.5. Gestão de Lotes, Cancelamento com Estorno e Disputas (`backend/app/services/lots.py`)
- `ensure_utc(dt)` e `resolve_lot_status(lot, now)`: Determinam o status real do lote comparando `now_utc` com `start_time` e `end_time` sem depender apenas da string estática no banco.
- `sync_lot_temporal_state(db, lot)`: Se o relógio já passou de `end_time` e o lote ainda não foi liquidado, chama `settle_lot` na hora. Se passou de `start_time`, promove `SCHEDULED` para `LIVE`. Assim, mesmo que uma requisição chegue no intervalo entre dois ciclos do worker de 15s, o usuário sempre enxerga o estado exato.
- `get_next_lot_number(db)`: Calcula `MAX(lot_number) + 1` (iniciando em `101` quando o banco está vazio).
- `create_lot(db, auctioneer, payload)`: Valida que `end_time > start_time`, gera o snapshot imutável dos metadados da obra, define `head_hash = GENESIS_HASH` e publica o lote.
- `list_public_lots(db, status_filter, query_text)`: Lista lotes para a vitrine aplicando busca textual case-insensitive (`ILIKE`) por título, artista ou técnica (`medium_display`) e filtro por status (`LIVE`, `SCHEDULED`, `ENDED`), ordenando lotes ao vivo pelo menor tempo restante.
- `cancel_lot(db, auctioneer, lot_id)`: Faz lock no lote (`FOR UPDATE`), verifica que pertence ao leiloeiro logado e que ainda não encerrou. Se houver um licitante líder com saldo bloqueado (`leader_user_id` e `current_bid_cents`), bloqueia a carteira dele (`FOR UPDATE`), devolve integralmente o `committed_balance_cents`, grava uma transação `CANCEL_REFUND` no extrato, muda o lote para `CANCELLED` e transmite o evento `LOT_CANCELLED` via WebSocket.
- `get_my_disputes(db, bidder)`: Monta o painel de disputas do licitante classificando cada lote participado em `WINNING` (liderando ao vivo), `OUTBID` (superado ao vivo), `WON` (arrematado), `LOST` (encerrado vencido por outro) ou `CANCELLED`, junto com contadores de abas (`in_dispute`, `won`, `lost`, `total`) e o código do certificado quando houver vitória.

### 3.6. Catálogo Externo Resiliente com 4 Camadas e Circuit Breaker (`backend/app/services/catalog.py`)
Para cumprir o requisito de resiliência de integração externa, o módulo implementa:
- `CatalogCircuitBreaker`: Máquina de estados com três modos (`CLOSED`, `OPEN`, `HALF_OPEN`). Após 3 falhas consecutivas na API externa (`failure_threshold = 3`), abre o circuito por 60 segundos (`recovery_timeout = 60.0`), evitando que o backend fique preso esperando timeouts repetidos. Passados os 60s, entra em `HALF_OPEN` e testa a recuperação na próxima chamada.
- `CatalogCache`: Cache em memória com dois níveis de leitura: `get(key)` para dados frescos (TTL de 10 minutos) e `get_stale(key)` para recuperar o último resultado conhecido mesmo expirado caso a API externa caia.
- `_fetch_from_cleveland_api(query, skip, limit)`: Consulta `https://openaccess-api.clevelandart.org/api/artworks/` com `httpx.AsyncClient(timeout=4.0)` e até 2 tentativas com backoff exponencial + jitter aleatório.
- `_map_cleveland_item(item)`: Converte o JSON bruto do museu para o contrato interno padronizado (`external_id`, `title`, `artist`, `date_display`, `medium_display`, `image_url`, `attributes`).
- `_filter_local_fallback(query, skip, limit, notice)`: Filtra o catálogo curado embutido (`LOCAL_FALLBACK_ARTWORKS`, com 8 obras clássicas em SVG servidas localmente) e anexa um aviso transparente no campo `attributes.notice`.
- `search_catalog(query, skip, limit, db)`: Orquestra as 4 camadas em sequência:
  1. **Camada 1 (Cache Fresco):** Se a busca está no cache dentro do TTL de 10 min, retorna em menos de 1ms.
  2. **Camada 2 (API Externa com Retry e Circuit Breaker):** Se o disjuntor permitir, consulta o Cleveland Museum of Art, popula o cache e retorna.
  3. **Camada 3 (Stale Cache):** Se a API falhar ou o disjuntor estiver aberto, busca no cache expirado (`get_stale`) e injeta um aviso de contingência.
  4. **Camada 4 (Snapshots do Banco + Fallback Local SVG):** Se não houver cache prévio, consulta obras já salvas na tabela `lots` ou entrega os itens de `LOCAL_FALLBACK_ARTWORKS`. O endpoint `/api/v1/catalog` nunca retorna erro 500 para o leiloeiro.

### 3.7. Serviço de Auditoria Forense (`backend/app/services/audit.py`)
- `audit_lot_bid_chain(db, lot_id) -> AuditChainResponse`: Busca o lote e todos os seus lances ordenados por `sequence_number ASC`, delega a verificação matemática para `verify_bid_chain` e monta a resposta contendo `is_intact`, `tampered_at_sequence`, `genesis_hash`, `expected_head_hash`, `computed_head_hash` e a lista de `nodes` (cada um com `bidder_pseudonym`, `previous_hash`, `stored_current_hash`, `recomputed_hash`, `node_signature` e `status: "valid" | "invalid"`).

### 3.8. Gerenciador de WebSockets em Duplo Canal (`backend/app/services/websocket.py` e `backend/app/main.py`)
A classe `ConnectionManager` (`ws_manager`) mantém dois dicionários de conjuntos de sockets ativos:
1. **Canal público por lote (`/ws/lots/{lot_id}`):** Qualquer visitante assistindo a um lote recebe em tempo real os eventos:
   - `NEW_BID`: Novo lance aceito, novo líder mascarado, valor atualizado e se disparou anti-sniping.
   - `LOT_EXTENDED`: Novo `end_time` e contador de prorrogações.
   - `LOT_SETTLED`: Encerramento do lote, vencedor mascarado, valor final e `receipt_code`.
   - `LOT_CANCELLED`: Cancelamento pelo leiloeiro.
2. **Canal privado autenticado por usuário (`/ws/notifications?token=<JWT>`):** A função `stream_user_notifications` valida o JWT antes do handshake (`WS_1008_POLICY_VIOLATION` se inválido) e registra o socket em `_user_connections[user_id]`. Mesmo que o licitante esteja navegando na Vitrine ou na página da Carteira, se alguém cobrir o lance dele em qualquer lote, `send_user_notification` entrega um alerta instantâneo `OUTBID` com link direto para revidar.

### 3.9. Tabela de Endpoints REST e WebSocket (`backend/app/api/v1/`)

| Método | Rota | Autenticação | Função Handler | O que faz |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Pública | `register` | Cria usuário + carteira zerada, gera `public_code` e `masked_name`, retorna JWT. |
| `POST` | `/api/v1/auth/login` | Pública (Rate Limited) | `login` | Valida credenciais com bcrypt, aplica rate limit anti-brute-force e retorna JWT. |
| `GET` | `/api/v1/auth/me` | Bearer JWT | `get_me` | Retorna os dados do usuário logado a partir do token. |
| `GET` | `/api/v1/wallet` (e `/wallets/me`) | `BIDDER` | `get_wallet` | Retorna saldo total, comprometido e disponível em centavos. |
| `POST` | `/api/v1/wallet/deposit` | `BIDDER` | `deposit` | Credita depósito simulado com lock `FOR UPDATE` e gera extrato `DEPOSIT`. |
| `GET` | `/api/v1/wallet/transactions` | `BIDDER` | `list_transactions` | Lista o histórico completo de movimentações da carteira. |
| `GET` | `/api/v1/catalog` | Pública / Leiloeiro | `get_catalog` | Busca obras no Cleveland Museum com fallback automático de 4 camadas. |
| `POST` | `/api/v1/lots` | `AUCTIONEER` | `create_new_lot` | Publica um novo lote com snapshot da obra e `GENESIS_HASH`. |
| `GET` | `/api/v1/lots` | Pública | `get_public_lots` | Lista lotes da vitrine com filtro por `status` e busca textual `q`. |
| `GET` | `/api/v1/lots/my-disputes` | `BIDDER` | `get_current_user_disputes` | Retorna os lotes disputados pelo licitante com status e contadores. |
| `GET` | `/api/v1/lots/{lot_id}` | Pública | `get_lot_detail` | Sincroniza o estado temporal e retorna os detalhes e lances recentes do lote. |
| `POST` | `/api/v1/lots/{lot_id}/cancel` | `AUCTIONEER` | `cancel_existing_lot` | Cancela lote agendado/ativo e estorna automaticamente a caução do líder. |
| `POST` | `/api/v1/lots/{lot_id}/bids` | `BIDDER` (Rate Limited) | `submit_bid` | Processa lance com lock pessimista, reserva de saldo, anti-sniping e hash chain. |
| `GET` | `/api/v1/lots/{lot_id}/audit` | Pública | `get_lot_audit_chain` | Recalcula todos os hashes e assinaturas do lote e aponta adulterações. |
| `GET` | `/api/v1/receipts/{receipt_code}` | Pública | `fetch_public_receipt` | Consulta e verifica a assinatura HMAC de um comprovante de arremate. |
| `GET` | `/api/v1/me/bids-and-wins` | `BIDDER` | `fetch_my_bids_and_wins` | Retorna histórico consolidado de participações e certificados ganhos. |
| `GET` | `/api/v1/auctioneer/dashboard` | `AUCTIONEER` | `fetch_auctioneer_dashboard` | Retorna faturamento total liquidado, contadores e lista de lotes do leiloeiro. |
| `GET` | `/health` | Pública | `check_auction_system_health` | Testa `SELECT 1` no PostgreSQL e retorna status de saúde da API. |
| `WS` | `/ws/lots/{lot_id}` | Pública | `stream_auction_lot_bids` | Streaming ao vivo de lances, prorrogações e encerramento do lote. |
| `WS` | `/ws/notifications?token=...` | Bearer JWT | `stream_user_notifications` | Canal pessoal de alertas em tempo real quando o licitante tem o lance coberto. |

---

## 4. Análise completa do Frontend (React 18 + TypeScript + Tailwind)

Na interface, fugi daquele visual genérico de dashboard de template pronto. Criei uma identidade inspirada em catálogos editoriais de casas de leilão clássicas (como Sotheby's e Christie's), combinando papel quente (`#F7F4EE`) no modo claro, carvão (`#111113`) no modo escuro, títulos serifados em `Cormorant Garamond`, textos de leitura em `Inter` e todos os valores financeiros, cronômetros e hashes em fonte monoespaçada `JetBrains Mono` com `font-variant-numeric: tabular-nums` (para que os números nunca pulem pros lados enquanto o relógio corre).

### 4.1. Contextos Globais (`frontend/src/context/`)
- **`AuthContext.tsx` (`AuthProvider`, `useAuth`):** Gerencia a sessão JWT no `localStorage`, restaura o usuário logado no boot via `loadSession()`, expõe `login`, `register`, `logout` e a função `quickSeedLogin(preset)` que permite alternar com 1 clique no topo da tela entre a Leiloeira (Helena), o Licitante 1 (Nicolas) e a Licitante 2 (Marina) para facilitar a avaliação da banca.
- **`WalletContext.tsx` (`WalletProvider`, `useWallet`):** Mantém em memória o `wallet` (`total_balance_cents`, `committed_balance_cents`, `available_balance_cents`) e o array `transactions`. Expõe `refreshWallet()` e `deposit(amountCents)`, atualizando o cabeçalho e a sala de lances instantaneamente após qualquer oferta ou depósito.
- **`ThemeContext.tsx` (`ThemeProvider`, `useTheme`):** Controla o modo claro e escuro aplicando a classe `.dark` no elemento `<html>` e salvando a preferência em `verzel_theme`.
- **`NotificationContext.tsx` (`NotificationProvider`, `useNotifications`):** Abre a conexão WebSocket autenticada em `/ws/notifications?token=...` assim que um licitante faz login. Quando recebe um evento `OUTBID` ou `LOT_EXTENDED`:
  - Salva a notificação no histórico persistido por usuário no `localStorage`.
  - Empilha um toast flutuante (`aria-live="polite"`) no canto superior direito com botão direto `"Cobrir lance"` que leva o usuário para a sala do lote.
  - Toca um acorde discreto sintetizado via Web Audio API (`playDiscreetChime`, 587.33Hz -> 880Hz) caso o som de alertas esteja ativo.

### 4.2. Hooks Customizados (`frontend/src/hooks/`)
- **`useLotWebSocket.ts` (`useLotWebSocket(lotId)`):**
  - Faz a carga inicial do lote via REST (`lotsApi.getById`) e abre o WebSocket em `/ws/lots/{lotId}`.
  - Escuta `NEW_BID`, `LOT_EXTENDED`, `LOT_SETTLED` e `LOT_CANCELLED`, atualizando `lotData` e prepending o novo lance em `bidsHistory` sem precisar recarregar a página.
  - Se a conexão cair, agenda reconexão automática usando **backoff exponencial com jitter aleatório** (`1000 * 2^attempt + random(0..400)ms`), evitando que dezenas de abas reconectem exatamente no mesmo milissegundo (thundering herd). Ao reconectar, refaz o `fetchLotSnapshot` para garantir que nenhum lance enviado durante a queda foi perdido.
- **`useAuctionAudio.ts` (`useAuctionAudio()`):**
  - Sintetiza efeitos sonoros diretamente no navegador usando a **Web Audio API** (`AudioContext`, `OscillatorNode` e `GainNode`), sem carregar arquivos `.mp3` externos:
    - `playBidSound()`: Gera uma onda senoidal suave ascendente (`440Hz -> 880Hz` em 180ms) toda vez que um novo lance é confirmado na sala.
    - `playGavelSound()`: Gera um tom solene descendente (`330Hz -> 140Hz` em 380ms) simulando a batida do martelo quando o lote muda para `ENDED`.
    - `toggleMute()` e `isMuted`: Permitem silenciar o áudio da sala com persistência no `localStorage`, exposto em um botão acessível no topo da sala (`aria-label="Ativar/desativar som dos lances"`).

### 4.3. Acessibilidade WCAG AA e Conforto Vestibular (`frontend/src/index.css`)
- **Suporte a `prefers-reduced-motion: reduce`:** No `index.css`, adicionei uma media query global que desativa animações pulsantes, transições bruscas e transformações de escala quando o sistema operacional do usuário está configurado para reduzir movimento.
- **Contraste WCAG AA e Navegação por Teclado:** Todos os elementos interativos possuem `:focus-visible` nítido (borda bordô `#681417` no tema claro e dourado `#B08D57` no tema escuro), além de atributos `role="alert"`, `aria-live="polite"`, `aria-pressed` e `aria-expanded`.

### 4.4. Páginas e Componentes Principais (`frontend/src/pages/` e `frontend/src/components/`)
- **`Header.tsx`:** Cabeçalho editorial dividido em três faixas para nunca esmagar botões mesmo quando o licitante deposita milhões em saldo:
  1. Barra superior utilitária com os botões de troca rápida de conta de demonstração (`LEILOEIRA`, `LICITANTE 1`, `LICITANTE 2`), botão de Modo Escuro, sino de notificações (`NotificationBell`) e identificação mascarada.
  2. Faixa central com o emblema da Casa de Leilões (`VerzelEmblem`) e a navegação principal (`Vitrine de Lotes`, `Carteira`, `Meus Lances e Arremates` ou `Painel do Leiloeiro`).
  3. Faixa financeira dedicada (para licitantes) exibindo `Total`, `Comprometido` e `Disponível` lado a lado com botão rápido `+ R$ 1.000`.
- **`ShowcasePage.tsx` (Vitrine Principal):** Exibe os lotes em destaque e a grade filtrável por abas (`Todos`, `Ao vivo`, `Agendados`, `Encerrados`) e busca em tempo real por título, artista ou técnica. Também integra a seção `UserDisputesSection.tsx` para que o licitante acompanhe seus lotes em disputa direto na home.
- **`LiveAuctionPage.tsx` e `BidControlPanel.tsx` (Sala de Disputa ao Vivo):**
  - Exibe a obra emoldurada (`ArtworkFrame.tsx` e `LotArtworkDetails.tsx`), o cronômetro regressivo (`CountdownBadge.tsx`) com badge `+2 min` quando há anti-sniping e o feed de lances em tempo real (`BidHistoryFeed.tsx`).
  - **Indicador Dinâmico de Posição do Licitante (WCAG AA):** No `BidControlPanel.tsx`, o comprador vê imediatamente sua situação no lote:
    - Se for o líder atual: Badge verde de alto contraste `✓ VOCÊ ESTÁ GANHANDO`.
    - Se já deu lance no lote mas foi coberto: Badge âmbar de alerta `⚠ VOCÊ FOI SUPERADO! Dê um novo lance`.
    - Se ainda não participou: Badge neutra indicando `Lance mínimo necessário: R$ ...`.
  - Oferece botões de lance rápido (`Mínimo`, `+ 1 incremento`, `+ 2 incrementos`) e campo manual formatado em reais.
- **`AuctioneerDashboardPage.tsx` (Painel do Leiloeiro):**
  - Aba `Lotes e Faturamento` (`AuctionLotsTable.tsx`): Mostra os cartões de faturamento total liquidado, quantidade de lotes arrematados e lotes em andamento, além da tabela completa com botão para **Cancelar Lote** (acionando o estorno automático) e link para o comprovante ou auditoria.
  - Aba `Catalogar Nova Obra` (`ArtworkCatalogPicker.tsx` + `LotPublishForm.tsx`): Permite pesquisar obras por termo ou filtros rápidos de curadoria (Impressionismo, Retratos, Paisagens, Arte Japonesa, Mestres Europeus), selecionar uma obra do Cleveland Museum of Art e publicar um lote definindo lance inicial, incremento mínimo e datas de abertura/fechamento.
- **`WalletPage.tsx` (Carteira e Extrato):** Exibe os três cartões de saldo (`Total`, `Comprometido em lances` e `Disponível`), botões de recarga rápida (`+ R$ 1.000`, `+ R$ 5.000`, `+ R$ 10.000`), formulário de depósito livre e a tabela completa do extrato (`DEPOSIT`, `BID_HOLD`, `BID_RELEASE`, `SETTLEMENT_DEBIT`, `CANCEL_REFUND`).
- **`MyBidsPage.tsx` e `UserDisputesSection.tsx` (Meus Lances e Arremates):** Organiza as participações do comprador em abas (`Em disputa`, `Arrematados`, `Não arrematados`, `Todos`), destaca se o lance está liderando ou foi superado e exibe os certificados oficiais dos lotes vencidos.
- **`ReceiptPage.tsx` (Comprovante Público Verificável):** Acessível publicamente via `/receipts/:code`. Mostra os dados da obra arrematada, o licitante vencedor mascarado, o valor final liquidado, o hash do lance vencedor, a assinatura `HMAC-SHA256`, o selo de verificação (`Assinatura válida` / `Assinatura inválida`) e botão para copiar o link público de compartilhamento.
- **`LotAuditPage.tsx` (Auditoria Criptográfica Pública):** Acessível por qualquer pessoa em `/lots/:id/audit`. Exibe o veredito da verificação (`Cadeia Íntegra` em verde ou `Adulteração Detectada no Lance #N` em vermelho) e desenha cada elo da cadeia mostrando `Pseudônimo LGPD`, `Valor`, `Timestamp UTC`, `Hash Anterior`, `Hash Armazenado`, `Hash Recalculado`, `Assinatura HMAC do Nó` e o status individual (`ÍNTEGRO` ou `INVÁLIDO`).

### 4.5. Utilitários de Formatação e Tempo (`frontend/src/utils/formatters.ts`)
- `formatBrlCents(cents)`: Divide o inteiro por 100 e formata no padrão monetário brasileiro (`Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`).
- `parseBrlToCents(input)`: Limpa símbolos de moeda, pontos de milhar e troca vírgula decimal por ponto antes de converter para centavos inteiros (`Math.round(parsed * 100)`).
- `calculateCountdown(targetIso, nowMs)`: Calcula horas, minutos e segundos restantes, além das flags `isExpired` e `isCritical` (ativa quando faltam menos de 2 minutos, mudando a cor do cronômetro para alerta).
- `truncateHash(hash, startChars, endChars)`: Formata hashes longos de 64 caracteres para exibição compacta (`a1b2c3d4e5...9f8e7d6c`).

---

## 5. Cobertura de requisitos do desafio (Obrigatórios e Opcionais)

Comparei cada item do PDF **Teste técnico: Elite Dev na Verzel** com o que está rodando no projeto:

| Requisito do Desafio | Tipo | Status | Onde está implementado |
| :--- | :--- | :--- | :--- |
| Vitrine separando lotes ativos, agendados e encerrados | Obrigatório | Concluído | `ShowcasePage.tsx` + `GET /api/v1/lots` |
| Leiloeiro busca itens da API pública e publica lotes | Obrigatório | Concluído | `AuctioneerDashboardPage.tsx` + `catalog.py` + `POST /api/v1/lots` |
| Leiloeiro acompanha andamento e faturamento recebido | Obrigatório | Concluído | `get_auctioneer_dashboard` (`settlement.py`) |
| Sala de disputa ao vivo via WebSockets sem reload | Obrigatório | Concluído | `LiveAuctionPage.tsx` + `useLotWebSocket.ts` + `websocket.py` |
| Carteira com depósito simulado e separação Total / Comprometido / Disponível | Obrigatório | Concluído | `WalletPage.tsx` + `wallet.py` + constraints no PostgreSQL |
| Histórico de lances, lotes vencidos e comprovante compartilhável | Obrigatório | Concluído | `MyBidsPage.tsx` + `ReceiptPage.tsx` (`/receipts/:code`) |
| Página pública de auditoria verificando integridade dos lances | Obrigatório | Concluído | `LotAuditPage.tsx` + `audit.py` + `crypto.py` |
| Feedback claro de rejeição de lance (motivo + valor mínimo) | Obrigatório | Concluído | `place_bid` (`bidding.py`) + alerta em `BidControlPanel.tsx` |
| Resiliência contra queda/lentidão da API externa | Obrigatório | Concluído | `CatalogCircuitBreaker` + 4 camadas de fallback (`catalog.py`) |
| Regras de lance (incremento mínimo, bloqueio do líder, lock concorrente) | Obrigatório | Concluído | `SELECT ... FOR UPDATE` ordenado em `bidding.py` |
| Anti-sniping (+2 min nos 2 minutos finais, acumulativo) | Obrigatório | Concluído | `bidding.py` (`ANTI_SNIPING_WINDOW_SECONDS = 120`) |
| Liquidação financeira (débito do vencedor, crédito do leiloeiro, lote deserto) | Obrigatório | Concluído | `settle_lot` + worker autônomo a cada 15s (`settlement.py`) |
| Detecção de adulteração ou exclusão direto no banco de dados | Obrigatório | Concluído | `verify_bid_chain` (`crypto.py`) + `test_audit_tampering.py` |
| **Busca e filtro** na vitrine (texto e status) | **Opcional** | **Concluído** | `list_public_lots` (`lots.py`) + filtros em `ShowcasePage.tsx` |
| **Cancelamento de lote** com estorno automático do saldo comprometido | **Opcional** | **Concluído** | `cancel_lot` (`lots.py`) + transação `CANCEL_REFUND` |
| **Docker Compose** subindo todo o ambiente com um comando | **Opcional** | **Concluído** | `docker-compose.yml` (Postgres 16 + Backend + Frontend) |
| **Testes automatizados** cobrindo regras de negócio e concorrência | **Opcional** | **Concluído** | **80 testes automatizados** (67 no Pytest + 13 no Vitest) |
| **Dark Mode** na interface | **Opcional** | **Concluído** | `ThemeContext.tsx` + paleta `charcoal` no Tailwind |
| Acessibilidade WCAG AA (`prefers-reduced-motion` + Web Audio API) | Diferencial | **Concluído** | `useAuctionAudio.ts` + `index.css` + `BidControlPanel.tsx` |

---

## 6. Como rodar o projeto (Docker Compose e Local)

### Opção A: Subindo tudo com Docker Compose (Recomendado)

Com o Docker Desktop aberto, rode na raiz do repositório:

```bash
docker compose up --build
```

O que acontece automaticamente quando o comando sobe:
1. O container `db` inicia o PostgreSQL 16 (`leilao_verzel`) e aguarda o healthcheck (`pg_isready`).
2. O container `backend` roda as migrações do Alembic (`alembic upgrade head`), executa o script de seed idempotente (`python -m app.seed`) criando usuários, carteiras, lances encadeados e lotes de exemplo, e sobe o servidor Uvicorn na porta `8000`.
3. O container `frontend` sobe o servidor Vite na porta `5173`.

- **Frontend local:** http://localhost:5173
- **Swagger / Docs da API local:** http://localhost:8000/docs
- **Healthcheck da API:** http://localhost:8000/health

### Opção B: Rodando localmente sem Docker (Desenvolvimento)

1. **Banco de Dados:** Tenha uma instância PostgreSQL rodando localmente com um banco chamado `leilao_verzel` (ou configure `DATABASE_URL` no arquivo `backend/.env` baseado no `.env.example`).
2. **Backend:**
   ```bash
   cd backend
   python -m venv .venv
   # No Windows: .venv\Scripts\activate | No Linux/Mac: source .venv/bin/activate
   pip install -e ".[dev]"
   alembic upgrade head
   python -m app.seed
   uvicorn app.main:app --reload --port 8000
   ```
3. **Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

## 7. Contas pré-configuradas (Seed) e roteiro de testes

O script `backend/app/seed.py` já popula o banco com 3 contas prontas e 4 lotes em diferentes estados (1 encerrado e liquidado com comprovante, 2 ao vivo com lances encadeados e 1 agendado). Você pode alternar entre essas contas com **1 clique** usando os botões no topo da interface:

| Perfil | Papel (`role`) | Nome Mascarado | E-mail | Senha | Saldo Inicial (Seed) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Helena Curadora** | `AUCTIONEER` (Leiloeira) | `LEI-XXXX (H***a C.)` | `curador@verzel.com.br` | `Verzel2026!` | Recebe os créditos dos lotes liquidados |
| **Nicolas Brito** | `BIDDER` (Licitante 1) | `LIC-XXXX (N***s B.)` | `nicolas@verzel.com.br` | `Verzel2026!` | R$ 15.000,00 (com lances ativos e 1 lote arrematado) |
| **Marina Silva** | `BIDDER` (Licitante 2) | `LIC-XXXX (M***a S.)` | `marina@verzel.com.br` | `Verzel2026!` | R$ 12.000,00 (em disputa nos lotes ativos) |

---

## 8. Como testar a detecção de adulteração no banco (SQL Tampering)

Se você quiser reproduzir manualmente o cenário de um invasor ou DBA mal-intencionado alterando um lance direto no PostgreSQL para ver a auditoria pegando a fraude:

1. Abra qualquer lote com lances na interface e clique em **Auditoria** (`/lots/{id}/audit`). Você verá o selo verde **Cadeia Íntegra (`is_intact: true`)** e todos os nós marcados como `ÍNTEGRO`.
2. Conecte no banco PostgreSQL (ou via `docker exec -it leilao_verzel_db psql -U postgres -d leilao_verzel`) e altere o valor do lance de sequência #2 sem passar pela API:
   ```sql
   UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2;
   ```
3. Recarregue a página de **Auditoria** do lote ou chame `GET /api/v1/lots/{id}/audit`:
   - O status geral muda imediatamente para **Adulteração Detectada (`is_intact: false`)**.
   - O campo `tampered_at_sequence` aponta com precisão cirúrgica para o nó `2`.
   - O lance #2 mostra o `stored_current_hash` divergente do `recomputed_hash`, e tanto o lance #2 quanto o lance #3 (e quaisquer subsequentes) ficam marcados como `INVÁLIDO` (`status: "invalid"`) por quebra do encadeamento criptográfico.

Esse mesmo fluxo é testado de forma automatizada em `backend/tests/test_audit_tampering.py`.

---

## 9. Suíte de testes automatizados (80 testes)

Para ter segurança em cada refatoração, escrevi **80 testes automatizados** divididos entre backend e frontend.

### 9.1. Backend: 67 testes com Pytest (`backend/tests/`)
Para rodar toda a suíte do backend:
```bash
cd backend
pytest
```
- `test_audit_tampering.py` (2 testes): Cria lote com 3 lances encadeados, valida pseudônimos LGPD (`LICITANTE-XXXXXXXXXX`), executa `UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2` via SQL direto e comprova que `is_intact` vira `False`, `tampered_at_sequence == 2` e os nós 2 e 3 viram `invalid`.
- `test_audit.py` (4 testes): Testa integridade da cadeia, adulteração de valor, quebra de `previous_hash` e detecção de remoção do último lance via divergência com `head_hash`.
- `test_bidding_concurrency.py` (3 testes): Dispara rajadas de lances concorrentes com `asyncio.gather` para provar que apenas lances válidos entram, a sequência não duplica e o saldo comprometido nunca fica inconsistente.
- `test_bidding.py` (10 testes): Cobre lance mínimo, incremento mínimo, bloqueio de auto-superação pelo líder, falta de saldo disponível, troca de reserva entre líder antigo e novo líder, e prorrogação acumulativa de anti-sniping (+120s).
- `test_catalog_resilience.py` e `test_catalog.py` (9 testes): Testam cache em memória, abertura do `CatalogCircuitBreaker` após 3 falhas HTTP, fallback para stale cache, fallback para acervo local SVG e imutabilidade do snapshot da obra no lote.
- `test_settlement_and_ws.py` (6 testes): Testam liquidação com vencedor (débito da carteira do comprador, crédito na carteira do leiloeiro e emissão de certificado assinado), encerramento de lote sem lances (deserto), idempotência de liquidação e broadcast WebSocket.
- `test_lots.py` (8 testes): Criação de lotes, filtros de vitrine, busca textual e cancelamento de lote com estorno automático (`CANCEL_REFUND`).
- `test_my_disputes_api.py` (4 testes): Classificação de disputas (`WINNING`, `OUTBID`, `WON`, `LOST`) e contadores do painel do licitante.
- `test_notifications_websocket.py` (4 testes): Autenticação do canal `/ws/notifications`, rejeição de token inválido e entrega em tempo real do alerta `OUTBID`.
- `test_rate_limiting.py` (4 testes): Bloqueio `HTTP 429` após excesso de tentativas de login ou rajada de lances acima de 30/minuto.
- `test_crypto_and_privacy.py`, `test_auth_wallet_catalog.py`, `test_models.py` e `test_seed.py` (13 testes): Validação de hashes, mascaramento de nomes, depósitos em carteira e idempotência do seed.

### 9.2. Frontend: 13 testes com Vitest (`frontend/src/tests/`)
Para rodar a suíte do frontend:
```bash
cd frontend
npm test -- --run
```
- `unit.test.ts` (7 testes): Formatação de centavos para BRL, parsing de strings monetárias digitadas pelo usuário, cálculo de contagem regressiva, detecção de janela crítica de anti-sniping e truncamento de hashes.
- `disputes.test.ts` (4 testes): Regras de filtragem das abas do painel de disputas (`Em disputa`, `Arrematados`, `Não arrematados`, `Todos`).
- `notifications.test.ts` (2 testes): Estado de leitura, contagem de alertas pendentes e limpeza de notificações.

---

## 10. Onde e como usei IA

O documento do desafio pede para contar de forma aberta onde e como usei IA e o que revisei ou ajustei. Como desenvolvedor, encaro assistentes de IA como um par de programação para ganhar velocidade em código repetitivo, mas nunca como piloto automático para decisões de arquitetura, concorrência ou regras financeiras.

Abaixo detalho exatamente o que deleguei para a IA acelerar e onde precisei intervir, corrigir ou escrever na mão porque a sugestão padrão da IA introduziria bugs sérios em produção:

### 10.1. Onde a IA me ajudou a ganhar tempo (Aceleração de Boilerplate)
- **Scaffolding de Schemas Pydantic e Interfaces TypeScript:** Depois que defini a modelagem das 6 tabelas do banco, usei IA para gerar o esqueleto inicial dos schemas de resposta em `backend/app/schemas/` e os tipos espelhados em `frontend/src/types/api.ts`.
- **Ilustrações SVG de Contingência:** Pedi auxílio para montar os arquivos vetoriais SVG em `frontend/public/artworks/` (como *Nighthawks*, *The Great Wave* e *Water Lilies*) que servem de fallback visual quando a rede externa está indisponível.
- **Estrutura base de componentes visuais e Tailwind:** Usei para adiantar a marcação HTML/Tailwind de tabelas e formulários antes de refinar a hierarquia visual, responsividade e acessibilidade.

### 10.2. O que eu projetei, revisei e precisei corrigir na mão (Engenharia e Domínio)
1. **Troca de `float` por centavos inteiros (`BIGINT`) e CheckConstraints no banco:**
   - *O que a IA sugeriu inicialmente:* Usar `float` ou `Decimal` solto sem restrições no banco e calcular `available_balance = total_balance - committed_balance` apenas no frontend.
   - *Minha intervenção:* Recusei a abordagem com ponto flutuante e modelei toda a base em centavos inteiros (`BigInteger`), além de escrever as três `CheckConstraint` na tabela `wallets` (`total >= 0`, `committed >= 0` e `committed <= total`). Isso garante que o próprio PostgreSQL seja a última barreira de integridade financeira.
2. **Prevenção de Deadlock em lances simultâneos (`SELECT ... FOR UPDATE` com ordenação determinística):**
   - *O que a IA sugeriu inicialmente:* Fazer `SELECT` simples na carteira do licitante atual e depois no líder anterior conforme a ordem do fluxo do código. Sob concorrência real (quando o Licitante A cobre o B num lote ao mesmo tempo em que o B cobre o A em outro), isso trava o banco em deadlock ou permite saldo comprometido duplicado.
   - *Minha intervenção:* Projetei a sequência de locks em `backend/app/services/bidding.py` e `settlement.py` para primeiro travar a linha do lote (`with_for_update()`) e, em seguida, ordenar os UUIDs dos usuários envolvidos (`sorted(..., key=lambda uid: str(uid))`) antes de dar `with_for_update()` nas carteiras. Também escrevi o teste `test_bidding_concurrency.py` disparando lances simultâneos para validar esse comportamento na prática.
3. **Auditoria Forense Real (Detecção de `DELETE` de linhas e cascata de invalidação):**
   - *O que a IA sugeriu inicialmente:* Uma função que apenas recalculava `sha256` de cada linha isoladamente. Se um DBA apagasse o último lance ou um lance do meio e ajustasse apenas uma linha, ou se mudasse o lance #2, os lances #3 e #4 continuavam aparecendo como `"valid"` se o `previous_hash` deles não fosse confrontado contra o hash recalculado.
   - *Minha intervenção:* Reescrevi `verify_bid_chain` em `backend/app/core/crypto.py` para partir obrigatoriamente de `GENESIS_HASH = "0" * 64`, exigir sequência estrita `1..N`, propagar o estado `"invalid"` em cascata para todos os nós subsequentes assim que o primeiro elo quebra, confrontar o último nó com `lot.head_hash` e `lot.bid_count`, e pseudonimizar o licitante com `HMAC-SHA256` (`LICITANTE-XXXXXXXXXX`) para cumprir a LGPD sem perder auditabilidade.
4. **Padronização de Timezone UTC (`offset-naive` vs `offset-aware`):**
   - *O que aconteceu nos testes:* O código inicial misturava `datetime.utcnow()` (sem timezone) com objetos `TIMESTAMPTZ` vindos do PostgreSQL, estourando `TypeError: can't compare offset-naive and offset-aware datetimes` na validação da janela de 120s do anti-sniping.
   - *Minha intervenção:* Criei `utc_now()` em `models/base.py`, `ensure_utc()` em `services/lots.py` e `format_utc_iso()` em `core/crypto.py`, garantindo que toda comparação temporal e todo cálculo de hash usem sempre UTC com precisão fixa de microssegundos.
5. **Migração da API de Obras e Arquitetura de Resiliência em 4 Camadas:**
   - *O que aconteceu na prática:* A API do Art Institute of Chicago bloqueava requisições vindas de IPs de nuvem com erro 403 da Cloudflare.
   - *Minha intervenção:* Migrei o cliente HTTP para a API Open Access do Cleveland Museum of Art e implementei o `CatalogCircuitBreaker` (abre após 3 falhas por 60s), o `CatalogCache` (com suporte a leitura fresca e *stale cache*), o snapshot completo da obra salvo na tabela `lots` no momento da publicação e o fallback local, garantindo disponibilidade contínua.
6. **Refatoração do Header e Ergonomia da Sala de Lances:**
   - *Ajuste visual e de usabilidade:* Quando o licitante depositava valores altos na carteira, o card de saldo espremia os botões de navegação no topo. Reestruturei o `Header.tsx` em 3 faixas independentes, adicionei os indicadores de posição com contraste WCAG AA (`✓ VOCÊ ESTÁ GANHANDO` / `⚠ VOCÊ FOI SUPERADO!`), suporte a `prefers-reduced-motion` e síntese de áudio via Web Audio API (`useAuctionAudio.ts`).

---

### Resumo

> Utilizei IA como ferramenta de produtividade para acelerar o scaffolding inicial de schemas Pydantic, interfaces TypeScript, marcação base de componentes Tailwind e geração dos vetores SVG de fallback das obras de arte.
>
> Toda a arquitetura crítica e as regras de negócio foram desenhadas, revisadas e ajustadas manualmente por mim:
> 1. **Domínio Financeiro e Concorrência:** Substituí sugestões iniciais baseadas em ponto flutuante e leituras simples por inteiros em centavos (`BIGINT`), `CheckConstraints` diretamente no PostgreSQL e bloqueio pessimista (`SELECT ... FOR UPDATE`) com ordenação determinística de `user_id` para evitar deadlocks e condições de corrida entre lances simultâneos.
> 2. **Auditoria Criptográfica e LGPD:** Reescrevi a verificação da cadeia de lances (`crypto.py` e `audit.py`) para validar desde o `GENESIS_HASH` (`"0" * 64`), assinar nós via HMAC, anonimizar licitantes (`LICITANTE-XXXXXXXXXX`) e propagar invalidação em cascata caso um DBA adultere ou exclua registros direto via SQL (`test_audit_tampering.py`).
> 3. **Resiliência de Integração Externa:** Ao detectar bloqueios 403 por Cloudflare na API do Art Institute of Chicago em ambiente cloud, migrei a integração para o Cleveland Museum of Art e implementei um Circuit Breaker com 4 camadas de contingência (cache TTL, retry com backoff exponencial + jitter, stale cache e fallback local), além de salvar o snapshot da obra no lote.
> 4. **Tempo Real, Timezone e Acessibilidade:** Corrigi comparações de datas `offset-naive` vs `offset-aware` padronizando tudo em UTC (`TIMESTAMPTZ`), implementei reconexão WebSocket com jitter no frontend, adicionei síntese sonora leve via Web Audio API (`useAuctionAudio.ts`) e conformidade WCAG AA com `prefers-reduced-motion`. Tudo validado por 80 testes automatizados (67 no Pytest e 13 no Vitest).
