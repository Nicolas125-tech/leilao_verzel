# 0001. Decisoes de Arquitetura da Casa de Leiloes

Status: Aceito
Data: 2026-10-22

## Contexto

O sistema consiste em uma plataforma de leiloes online em tempo real onde leiloeiros catalogam obras de arte a partir de uma API publica e licitantes disputam cada lote com saldo de carteira. O dominio exige consistencia financeira estrita sob concorrencia de lances, resiliencia contra instabilidades da fonte externa de dados, atualizacao instantanea na interface sem recarregamento de pagina e um mecanismo publico de auditoria capaz de detectar adulteracoes diretas no banco de dados relacional.

## Decisoes

### 1. Stack de Back-End e Persistencia Relacional

Optamos por Python 3.12 com FastAPI, SQLAlchemy 2.0 (modo assincrono/sincrono controlado com tipagem estrita), Alembic para versionamento de schema e PostgreSQL (`leilao_verzel`). O PostgreSQL foi escolhido pela maturidade no controle de isolamento transacional e suporte nativo a bloqueio pessimista de linha (`SELECT ... FOR UPDATE`), requisito essencial para evitar condicoes de corrida na disputa de lances e na reserva de saldo.

### 2. Representacao Monetaria em Centavos e Bloqueio Pessimista

Valores financeiros nunca utilizam ponto flutuante (`float`). Todos os saldos, lances iniciais, incrementos e valores de arremate sao armazenados e processados como inteiros em centavos (`BIGINT` no PostgreSQL e `int` no Python).

Durante o processamento de um lance, a transacao adquire lock exclusivo na linha do lote (`SELECT ... FOR UPDATE`) e nas carteiras dos usuarios envolvidos em ordem deterministica de identificador para prevenir deadlocks. Na mesma transacao:
1. Valida-se a janela temporal do lote, o valor minimo exigido e se o licitante ja nao e o lider atual.
2. Verifica-se se o saldo disponivel (`total_balance_cents - committed_balance_cents`) comporta o novo lance.
3. Caso exista um lider anterior, o valor antes retido no `committed_balance_cents` dele e liberado imediatamente, voltando para o seu saldo disponivel.
4. O valor do novo lance passa a integrar o `committed_balance_cents` do novo lider e cada movimentacao gera registro no livro-razao (`wallet_transactions`).

Essa abordagem garante que um licitante superado recupere seu poder de compra no mesmo milissegundo e impede que um mesmo saldo disponivel seja gasto em dois lotes simultaneos.

### 3. Desacoplamento e Resiliencia da API Externa

Para o catalogo de obras e raridades, integramos a API publica do Art Institute of Chicago (`api.artic.edu`). Como APIs publicas estao sujeitas a indisponibilidade, lentidao ou limites de taxa, o cliente HTTP no back-end opera com timeout curto (4 segundos) e possui um catalogo local de contingencia acionado automaticamente em caso de falha de rede.

Mais importante: a API externa e consultada exclusivamente no momento de pesquisa pelo leiloeiro. Ao publicar um lote, o back-end persiste uma copia completa dos dados da obra (titulo, autor, datacao, URL da imagem e objeto JSON de atributos tecnicos) diretamente na tabela `lots` do PostgreSQL. Dessa forma, a vitrine, a sala de pregao ao vivo, a liquidacao, o comprovante e a auditoria funcionam com autonomia total mesmo se a API externa ficar fora do ar.

### 4. Prorrogacao Anti-Sniping e Liquidacao Automatica

Lances validos recebidos nos ultimos 120 segundos antes do `end_time` redefinem o encerramento do lote para `agora + 2 minutos`, garantindo tempo habil de reacao aos demais licitantes.

A liquidacao ocorre por meio de duas camadas complementares:
1. Um worker assincrono em background executado no ciclo de vida do FastAPI verifica a cada segundo lotes cujo `end_time` expirou utilizando `SELECT ... FOR UPDATE SKIP LOCKED`.
2. Uma verificacao sob demanda (lazy evaluation) e executada antes de leituras ou tentativas de lance sobre um lote, garantindo que nenhum estado vencido fique pendente.

No encerramento de um lote com lances, o sistema debita em definitivo o saldo comprometido do vencedor, credita o montante na carteira do leiloeiro e emite o comprovante de arremate com codigo publico compartilhavel. No cancelamento de lote pelo leiloeiro (permitido em lotes agendados ou ao vivo), se houver lance lider ativo, o saldo comprometido retorna automaticamente ao saldo disponivel do licitante.

### 5. Cadeia Criptografica de Auditoria contra Adulteracao SQL

Para atender ao requisito de deteccao de qualquer edicao, remocao ou insercao manual no historico de lances (inclusive via cliente SQL direto no banco), implementamos uma cadeia de hashes assinada com segredo do servidor (`HMAC-SHA256`).

Cada lance recebe um `sequence_number` sequencial por lote (iniciando em 1), o `previous_hash` (sendo `"GENESIS"` para o primeiro lance) e o `current_hash` calculado sobre a string canonica:
`{lot_id}|{sequence_number}|{bidder_public_id}|{amount_cents}|{created_at_iso}|{previous_hash}`

Alem disso, a propria tabela `lots` armazena o `bid_count` e o `head_hash` (hash do ultimo lance aceito). O endpoint publico de auditoria le todos os lances diretamente do PostgreSQL, recalcula cada hash desde o bloco `GENESIS`, confere a continuidade dos numeros de sequencia e confronta o topo da cadeia com `bid_count` e `head_hash` do lote. Assim, qualquer `UPDATE` de valor, `DELETE` de lance intermediario ou ate mesmo `DELETE` do ultimo lance da fila rompe a verificacao matematica e sinaliza a adulteracao imediatamente na interface publica.

### 6. Privacidade de Licitantes

Dados pessoais como nome completo e e-mail nunca trafegam nos payloads publicos, nos eventos de WebSocket da sala, na pagina de auditoria ou no comprovante de arremate. Cada usuario recebe na criacao um identificador publico deterministico e um nome abreviado mascarado no formato `LIC-48F9 (N***s B.)`, suficiente para o licitante reconhecer seus proprios lances e para terceiros auditarem a disputa com preservacao de privacidade.
