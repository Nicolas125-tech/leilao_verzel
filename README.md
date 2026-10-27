# Casa de Leilões Verzel

![Python](https://img.shields.io/badge/Python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-Async-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-with__for__update-blue)
![Pytest](https://img.shields.io/badge/Testes-53%20Passing-brightgreen)
![Audit](https://img.shields.io/badge/Audit-SHA256%20Chain-purple)

- Aplicação no ar (Frontend): https://leilao-verzel.vercel.app
- API em produção (Backend Docs): https://leilao-verzel.onrender.com/docs

Plataforma de pregão online de obras de arte em tempo real, integrada ao acervo público do Cleveland Museum of Art (Open Access). O sistema trata disputa simultânea de lances direto no banco com bloqueio de linha, separa o saldo livre do valor preso em lances ativos, estende o cronômetro quando entram ofertas nos últimos dois minutos (anti-sniping), faz a liquidação financeira ao fim do pregão e mantém uma trilha pública de auditoria por cadeia de hashes.

## 1. Arquitetura e stack

O projeto é dividido em três partes principais que sobem juntas via Docker Compose:

- Backend (`backend/`): Python 3.12, FastAPI, SQLAlchemy 2.0 assíncrono, Alembic, Pydantic v2, `httpx`, `PyJWT`, `bcrypt`, WebSockets nativos do FastAPI e Pytest.
- Banco de dados: PostgreSQL 16 (`leilao_verzel`). Todos os valores em dinheiro ficam salvos como inteiros em centavos (`BIGINT`) e os horários usam UTC (`TIMESTAMPTZ`).
- Frontend (`frontend/`): React 18, Vite, TypeScript e Tailwind CSS, com alternância entre tema claro (`#FAF9F6`) e escuro (`#141111`), tipografia `Cormorant Garamond`, `Plus Jakarta Sans` e `JetBrains Mono`, e números alinhados com `tabular-nums`.

## 2. Decisões técnicas na prática

### 2.1. Dinheiro em centavos e proteção contra concorrência
Para fugir de erros de arredondamento de ponto flutuante (`0.1 + 0.2`), toda a parte financeira roda com inteiros em centavos (`int` no Python e `BIGINT` no PostgreSQL).

Quando chega um lance em `POST /api/v1/lots/{lot_id}/bids`, o backend abre uma transação e aplica `SELECT ... FOR UPDATE` no lote e nas carteiras envolvidas. As carteiras são travadas sempre em ordem crescente de `user_id` para impedir deadlock quando dois usuários dão lances cruzados ao mesmo tempo. Dentro dessa mesma transação acontecem três coisas:
1. O valor que estava bloqueado do líder anterior é liberado (`BID_RELEASE`) e volta para o saldo disponível dele.
2. O valor do novo lance sai do saldo livre e entra no saldo comprometido (`committed_balance_cents`) do novo líder (`BID_HOLD`).
3. Se faltarem 120 segundos ou menos para o leilão acabar, o anti-sniping soma mais 120 segundos ao horário de encerramento (`end_time += 120s`, sem perder os segundos restantes) e incrementa `extension_count`.

### 2.2. Catálogo do Cleveland Museum of Art e fallback local
A rota `GET /api/v1/catalog?q=...` busca obras na API pública `https://openaccess-api.clevelandart.org/api/artworks/` (domínio público CC0, sem chave de API) com timeout curto de 4 segundos. Se a API externa demorar, cair ou devolver erro `5xx`, o backend troca automaticamente para a lista local `LOCAL_FALLBACK_ARTWORKS` em `backend/app/services/catalog.py`.

Assim que o leiloeiro publica um lote (`POST /api/v1/lots`), os metadados da obra (título, artista, data, técnica, imagem e atributos JSON) são copiados para a tabela `lots`. Com isso, a vitrine, a sala de lances, os recibos e a auditoria não dependem da disponibilidade do museu depois que o lote foi criado.

### 2.3. Privacidade de quem dá os lances
Nenhuma rota pública, evento de WebSocket, recibo ou tela de auditoria mostra o nome completo ou o e-mail dos participantes. No cadastro, cada pessoa recebe um código público fixo (`LIC-XXXX` ou `LEI-XXXX`) e aparece nos lances apenas com o nome mascarado no formato `LIC-XXXX (N***s B.)`.

### 2.4. Auditoria pública por cadeia de hashes
Cada lote começa com `head_hash = "GENESIS"` e `bid_count = 0`. Quando um lance entra, ele recebe `sequence_number = lot.bid_count + 1`, aponta o `previous_hash` para o `head_hash` atual do lote e calcula seu próprio `current_hash` com `HMAC-SHA256`:

`HMAC-SHA256(secret, "{lot_id}|{sequence_number}|{bidder_masked_name}|{amount_cents}|{created_at_iso}|{previous_hash}")`

Qualquer pessoa pode consultar `GET /api/v1/lots/{lot_id}/audit`. A rota lê os lances no banco, recalcula todos os hashes desde o bloco `GENESIS`, checa se não há saltos na numeração e confere se o último hash bate com o `head_hash` e o `bid_count` salvos no lote. Se alguém alterar um valor ou apagar uma linha direto no PostgreSQL, a auditoria acusa `is_chain_valid: false` e aponta em `broken_at_sequence` exatamente em qual lance a corrente quebrou.

## 3. Como rodar o projeto

### Opção A: tudo via Docker Compose

Na raiz do repositório, basta rodar:

```bash
docker compose up --build
```

O que sobe:
- PostgreSQL 16 na porta `localhost:5432`
- API FastAPI em `http://localhost:8000` (já roda `alembic upgrade head` e `python -m app.seed` na inicialização; documentação Swagger em `http://localhost:8000/docs`)
- Frontend React + Vite em `http://localhost:5173`

### Opção B: rodando backend e frontend localmente

1. Suba o banco PostgreSQL na porta `5432`:
   ```bash
   docker compose up -d db
   ```

2. Entre na pasta `backend/`, instale os pacotes, rode as migrations, popule o banco e inicie a API:
   ```bash
   cd backend
   pip install -r requirements.txt
   alembic upgrade head
   python -m app.seed
   uvicorn app.main:app --reload --port 8000
   ```

3. Em outro terminal, entre em `frontend/`, instale as dependências e rode o servidor do Vite:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 4. Contas de teste e lotes do seed

O script `backend/app/seed.py` pode ser rodado várias vezes sem duplicar dados. Na barra superior do site e na tela `/login` existem botões de acesso rápido para trocar entre as três contas com um clique:

| Perfil | Nome | E-mail | Senha | Papel |
| :--- | :--- | :--- | :--- | :--- |
| Leiloeiro | Helena Curadora | `curador@verzel.com.br` | `Verzel2026!` | `AUCTIONEER` |
| Licitante 1 | Nicolas Brito | `nicolas@verzel.com.br` | `Verzel2026!` | `BIDDER` |
| Licitante 2 | Marina Silva | `marina@verzel.com.br` | `Verzel2026!` | `BIDDER` |

Lotes criados inicialmente pelo seed:
- Lote #101 (`SCHEDULED`): *Nighthawks* (Edward Hopper), agendado para abrir em +1 dia e fechar em +8 dias.
- Lote #102 (`LIVE`, sem lances): *The Bedroom* (Vincent van Gogh), aberto por 7 dias, pronto para receber o lance de abertura.
- Lote #103 (`LIVE`, em disputa): *A Sunday on La Grande Jatte* (Georges Seurat), aberto por 7 dias com 3 lances já encadeados e saldo reservado na carteira do líder.
- Lote #104 (`ENDED`, liquidado): *Water Lilies* (Claude Monet), leilão já encerrado com saldo transferido e recibo público assinado (`ARP-`).
- Lote #105 (`CANCELLED`): *American Gothic* (Grant Wood), oculto na vitrine pública e visível no histórico do leiloeiro.

Atalhos úteis para testar:
- Os lotes ao vivo (`#102` e `#103`) ficam abertos por 7 dias a partir do momento em que o seed roda, então sempre há leilão ativo para testar lances na hora.
- No Painel do Leiloeiro (`/auctioneer`, aba `Catalogar Nova Obra`), o botão `Iniciar nos últimos 105s` cria um lote já dentro dos 2 minutos finais para testar o disparo do anti-sniping (`+2 min`) sem ter que esperar.

## 5. Principais rotas da API e WebSockets

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login` e `GET /api/v1/auth/me`
- `GET /api/v1/wallet`, `GET /api/v1/wallets/me`, `POST /api/v1/wallets/deposit` e `GET /api/v1/wallets/transactions`
- `GET /api/v1/catalog?q=...` (suporta paginação com `skip` e `limit`)
- `GET /api/v1/lots`, `POST /api/v1/lots`, `GET /api/v1/lots/{lot_id}` e `POST /api/v1/lots/{lot_id}/cancel`
- `POST /api/v1/lots/{lot_id}/bids`
- `GET /api/v1/lots/{lot_id}/audit`
- `GET /api/v1/receipts/{receipt_code}`
- `GET /api/v1/me/bids-and-wins`
- `GET /api/v1/auctioneer/dashboard`
- `WS /api/v1/ws/lots/{lot_id}` (também atende em `/ws/lots/{lot_id}`)

## 6. Testando a detecção de fraude direto no PostgreSQL

Para ver a auditoria pegando uma adulteração no banco:

1. Abra `http://localhost:5173`, entre no Lote #103 (*A Sunday on La Grande Jatte*) e clique em `Auditoria`.
2. Veja que o estado inicial mostra `Histórico íntegro: cadeia de lances verificada` para os lances da fila (`GENESIS -> #1 -> #2 -> #3`).
3. Pelo terminal, mude na mão o valor do lance `#2` direto na tabela `bids`:
   ```bash
   docker exec -it leilao_verzel_db psql -U postgres -d leilao_verzel -c "UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2;"
   ```
4. Volte para a tela de auditoria no navegador e clique em `Reexecutar auditoria`.
5. O painel vai ficar vermelho acusando adulteração na sequência `#2` (`is_chain_valid: false`) e mostrará lado a lado o hash que estava salvo e o hash recalculado.

## 7. Suíte de testes automatizados

Para rodar todos os testes do backend com Pytest:
```bash
python -m pytest backend/tests -v
```

Para rodar os testes unitários do frontend (formatação em centavos e cálculo do cronômetro e janela anti-sniping):
```bash
cd frontend
npm test
```

### Matriz de cobertura da suíte (53 testes)

| Escopo de responsabilidade | Qtd. de testes | O que é validado na prática |
| :--- | :---: | :--- |
| Carteira, depósito e permissões | 12 | Criação de conta, login JWT, bloqueio de leiloeiro na carteira, depósitos válidos/inválidos e extrato cronológico. |
| Criptografia, hashing e privacidade | 8 | Geração de código público fixo, máscara de nome LGPD, hash encadeado desde o `GENESIS`, adulteração via SQL `UPDATE`, exclusão de lance no meio/fim da fila e assinatura HMAC de recibos. |
| Concorrência, anti-sniping e rejeição | 6 | Disputa de lances, liberação imediata do saldo do líder anterior, rejeição por saldo insuficiente ou incremento menor que o mínimo, extensão de +120s na janela crítica e estorno em cancelamento. |
| Rate limiting (sliding window) | 5 | Limite de requisições por janela deslizante, bloqueio após tentativas seguidas de login inválido, controle de spam de lances e leitura correta de IP via proxy headers. |
| Liquidação e assinatura de comprovantes | 6 | Transferência atômica de valores no encerramento, geração de recibo público assinado, consulta pública do comprovante, listagem de arremates e transmissão de eventos via WebSocket. |
| Resiliência à queda da API externa | 5 | Busca no acervo do Cleveland Museum of Art, fallback automático para obras locais/SVG em caso de timeout ou erro HTTP 500, acesso público e paginação do catálogo. |
| Ciclo de vida do lote e seeds | 11 | Criação de lote com cópia completa da obra, filtros de busca/status na vitrine, transições de estado (`SCHEDULED`, `LIVE`, `ENDED`, `CANCELLED`), idempotência do seed e reset de dados de demonstração. |
| **Total** | **53** | **Execução automatizada no GitHub Actions a cada push/PR** |

## 8. Engenharia do projeto e uso transparente de IA

Usei ferramentas de IA durante o desenvolvimento como apoio de produtividade para acelerar o trabalho repetitivo: montar os schemas Pydantic iniciais, gerar tipagens TypeScript no frontend e estruturar o esqueleto de algumas fixtures de teste. Toda a arquitetura do sistema, a modelagem das transações no PostgreSQL e as regras de negócio foram desenhadas e implementadas por mim.

Em cenários reais de concorrência e consistência financeira, modelos de linguagem erram com frequência porque sugerem abordagens ingênuas que funcionam em testes isolados, mas quebram sob carga. Durante o desenvolvimento, assumi a resolução direta de pontos críticos onde a intervenção manual foi indispensável:

- Prevenção de deadlock com ordenação de locks: a rota de lances sugerida originalmente tentava atualizar saldos com `UPDATE` direto, sem bloqueio prévio. Isso permitia que requisições concorrentes gerassem saldo negativo e ainda abria brecha para deadlocks cruzados. Reescrevi a rotina em `backend/app/services/bidding.py` aplicando `SELECT ... FOR UPDATE` no lote e nas carteiras, ordenando os identificadores (`sorted(involved_user_ids)`) antes de solicitar o lock. Essa ordenação determinística elimina a espera circular (deadlock AB-BA) no PostgreSQL.
- Precisão monetária estrita em centavos: o modelo sugeriu campos com `float` e `Numeric`, o que causa divergências por imprecisão de dízimas binárias em contas de saldo e incrementos. Modelei todo o domínio financeiro com números inteiros em centavos (`int` no Python e `BIGINT` no banco de dados), restringindo divisões e conversões para decimais à camada visual da interface.
- Tratamento rigoroso de fuso horário em UTC: o código gerado misturava `datetime.utcnow()` sem fuso com objetos timezone-aware vindos do banco, disparando exceções do tipo `TypeError: can't compare offset-naive and offset-aware datetimes` durante a checagem da janela de anti-sniping. Centralizei a criação de timestamps em `backend/app/models/base.py` com `datetime.now(timezone.utc)` e colunas `TIMESTAMPTZ`, garantindo comparações consistentes em qualquer ambiente de deploy.
- Encadeamento criptográfico e detecção de exclusão: a validação de auditoria proposta inicialmente apenas recalculava o hash do lance atual de forma isolada. Se um registro intermediário ou o último lance fosse apagado direto no banco, o cálculo não acusava inconsistência. Estruturei a cadeia desde o bloco `GENESIS`, exigindo continuidade estrita (`previous_hash`) e validando o elo final contra `head_hash` e `bid_count` salvos no cabeçalho do lote.
- Resiliência contra bloqueios de API externa: quando a API do Art Institute of Chicago passou a retornar erro 403 por proteção Cloudflare durante os testes, migrei a integração para o acervo aberto do Cleveland Museum of Art (CC0) e criei uma contingência local com vetores SVG em `backend/app/services/catalog.py`, assegurando que a vitrine nunca fique indisponível.
- Estabilidade de WebSockets e anti-sniping: adicionei reconexão automática com recuo exponencial e jitter no cliente (`frontend/src/hooks/useLotWebSocket.ts`) para evitar sobrecarga no servidor após oscilações de conexão, e corrigi a extensão anti-sniping para somar 120 segundos ao término vigente em vez de sobrescrever o prazo, preservando os segundos acumulados na disputa.
