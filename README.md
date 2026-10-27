# Casa de Leilões Verzel



- **Aplicação no ar (Frontend):** https://leilao-verzel.vercel.app
- **API em produção (Backend Docs):** https://leilao-verzel.onrender.com/docs

Sistema web para pregão online de obras de arte em tempo real, integrado à API pública do Cleveland Museum of Art Open Access. A aplicação controla concorrência de lances no banco de dados, reserva saldo comprometido de forma atômica, aplica prorrogação anti-sniping nos minutos finais, liquida o lote no encerramento e expõe auditoria criptográfica pública por cadeia de hashes.

## 1. Arquitetura e stack

- Back-end (`backend/`): Python 3.12+, FastAPI, SQLAlchemy 2.0 (async), Alembic, Pydantic v2, `httpx`, `PyJWT`, `bcrypt`, WebSockets nativos do FastAPI e Pytest.
- Banco de dados: PostgreSQL 16 (`leilao_verzel`). Valores monetários são gravados como inteiros em centavos (`BIGINT`) e datas utilizam UTC (`TIMESTAMPTZ`).
- Front-end (`frontend/`): React 18, Vite, TypeScript e Tailwind CSS, com suporte a tema claro (`#FAF9F6`) e escuro (`#121214`), fontes `Inter` e `JetBrains Mono`, e alinhamento numérico `tabular-nums`.
- Infraestrutura: `docker-compose.yml` para subir PostgreSQL (`db`), API FastAPI com migrations e seed automáticos (`backend`) e interface React (`frontend`).

## 2. Decisões técnicas principais

### 2.1. Valores em centavos e controle de concorrência
Todos os cálculos financeiros usam inteiros em centavos (`int` no Python e `BIGINT` no PostgreSQL) para evitar imprecisão de ponto flutuante.

Ao receber um lance em `POST /api/v1/lots/{lot_id}/bids`, o backend aplica `SELECT ... FOR UPDATE` no registro do lote e nas carteiras envolvidas (ordenadas por `user_id` crescente para evitar deadlock). Dentro da mesma transação:
1. O valor antes retido do líder anterior é liberado (`BID_RELEASE`) e volta ao saldo disponível.
2. O valor do novo lance passa para o saldo comprometido (`committed_balance_cents`) do novo líder (`BID_HOLD`).
3. Se restarem 120 segundos ou menos para o encerramento, a regra de anti-sniping soma 120 segundos ao término vigente (`end_time += 120s`, preservando os segundos residuais) e soma 1 em `extension_count`.

### 2.2. Consulta ao Cleveland Museum of Art e contingência local
A rota `GET /api/v1/catalog?q=...` consulta a API pública `https://openaccess-api.clevelandart.org/api/artworks/` (licença CC0 de domínio público, sem exigência de chave de API e com imagens servidas por CDN de alta disponibilidade em `openaccess-cdn.clevelandart.org`) com timeout de 4 segundos. Em caso de timeout, erro HTTP (`5xx`) ou indisponibilidade de rede, o serviço aciona automaticamente a lista local `LOCAL_FALLBACK_ARTWORKS` definida em `backend/app/services/catalog.py`.

Quando o leiloeiro publica um lote (`POST /api/v1/lots`), os dados da obra (título, artista, data, técnica, URL da imagem e atributos JSON) são copiados para a tabela `lots`. Dessa forma, a vitrine, a sala ao vivo, os comprovantes e a auditoria continuam funcionando integralmente mesmo que a API externa fique indisponível.

### 2.3. Mascaramento de dados de licitantes
Rotas públicas, mensagens de WebSocket, recibos e logs de auditoria não expõem nome completo nem e-mail de licitantes. Cada conta recebe um código público determinístico (`LIC-XXXX` ou `LEI-XXXX`) e um identificador mascarado no padrão `LIC-XXXX (N***s B.)`.

### 2.4. Cadeia de hashes para auditoria criptográfica de lances
Todo lote inicia com `head_hash = "GENESIS"` e `bid_count = 0`. A cada lance aceito, o sistema define `sequence_number = lot.bid_count + 1`, copia `previous_hash = lot.head_hash` e gera o `current_hash` via `HMAC-SHA256`:

`HMAC-SHA256(secret, "{lot_id}|{sequence_number}|{bidder_masked_name}|{amount_cents}|{created_at_iso}|{previous_hash}")`

O endpoint público `GET /api/v1/lots/{lot_id}/audit` lê os lances do lote no banco, recalcula cada hash desde `GENESIS`, confere a sequência numérica e compara o último elo com `lot.head_hash` e `lot.bid_count`. Se alguma linha sofrer `UPDATE`, `INSERT` ou `DELETE` direto via SQL, a verificação retorna `is_chain_valid: false` e informa em `broken_at_sequence` o ponto exato da divergência.

## 3. Como executar o projeto

### Opção A: via Docker Compose

Na raiz do repositório, execute:

```bash
docker compose up --build
```

Serviços expostos:
- PostgreSQL 16: `localhost:5432`
- API FastAPI (executa `alembic upgrade head` e `python -m app.seed` na subida): `http://localhost:8000` (documentação OpenAPI em `http://localhost:8000/docs`)
- Interface React + Vite: `http://localhost:5173`

### Opção B: execução local sem Docker no backend e frontend

1. Suba o banco PostgreSQL na porta `5432`:
   ```bash
   docker compose up -d db
   ```

2. Configure e inicie o backend (`backend/`):
   ```bash
   cd backend
   pip install -r requirements.txt
   alembic upgrade head
   python -m app.seed
   uvicorn app.main:app --reload --port 8000
   ```

3. Instale as dependências e inicie o frontend (`frontend/`):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 4. Contas e lotes criados pelo seed

O script `backend/app/seed.py` é idempotente. As três contas abaixo também contam com botões de acesso rápido (1 clique) no topo da interface e na tela `/login`:

| Perfil | Nome | E-mail | Senha | Papel |
| :--- | :--- | :--- | :--- | :--- |
| Leiloeiro | Helena Curadora | `curador@verzel.com.br` | `Verzel2026!` | `AUCTIONEER` |
| Licitante 1 | Nicolas Brito | `nicolas@verzel.com.br` | `Verzel2026!` | `BIDDER` |
| Licitante 2 | Marina Silva | `marina@verzel.com.br` | `Verzel2026!` | `BIDDER` |

Lotes iniciais disponíveis após o seed:
- Lote #101 (`SCHEDULED`): *Nighthawks* (Edward Hopper), com início agendado para +1 dia e encerramento em +8 dias.
- Lote #102 (`LIVE`, sem lances): *The Bedroom* (Vincent van Gogh), aberto por 7 dias para receber o primeiro lance imediatamente.
- Lote #103 (`LIVE`, com disputa): *A Sunday on La Grande Jatte* (Georges Seurat), aberto por 7 dias com 3 lances encadeados e reserva ativa no saldo comprometido do líder.
- Lote #104 (`ENDED`, liquidado): *Water Lilies* (Claude Monet), encerrado com transferência financeira concluída e comprovante público emitido (`ARP-`).
- Lote #105 (`CANCELLED`): *American Gothic* (Grant Wood), oculto na vitrine pública e listado no painel do leiloeiro.

Recursos rápidos para a banca avaliadora:
- Os lotes ao vivo (`#102` e `#103`) permanecem válidos por 7 dias a partir da execução do seed, permitindo testar lances em tempo real sem precisar cadastrar lotes do zero.
- No Painel do Leiloeiro (`/auctioneer`, aba `Catalogar Nova Obra`), o botão de atalho `Iniciar nos últimos 105s` publica um lote já na janela crítica para validar imediatamente a prorrogação anti-sniping (`+2 min`).

## 5. Principais rotas da API e WebSockets

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login` e `GET /api/v1/auth/me`
- `GET /api/v1/wallet`, `GET /api/v1/wallets/me`, `POST /api/v1/wallets/deposit` e `GET /api/v1/wallets/transactions`
- `GET /api/v1/catalog?q=...`
- `GET /api/v1/lots`, `POST /api/v1/lots`, `GET /api/v1/lots/{lot_id}` e `POST /api/v1/lots/{lot_id}/cancel`
- `POST /api/v1/lots/{lot_id}/bids`
- `GET /api/v1/lots/{lot_id}/audit`
- `GET /api/v1/receipts/{receipt_code}`
- `GET /api/v1/me/bids-and-wins`
- `GET /api/v1/auctioneer/dashboard`
- `WS /api/v1/ws/lots/{lot_id}` (também acessível em `/ws/lots/{lot_id}`)

## 6. Como testar a detecção de adulteração no PostgreSQL

1. Abra `http://localhost:5173`, localize o Lote #103 (*A Sunday on La Grande Jatte*) e clique em `Auditoria`.
2. Verifique que o status inicial indica `Histórico íntegro: cadeia de lances verificada` para os 3 blocos (`GENESIS -> #1 -> #2 -> #3`).
3. Em um terminal, altere manualmente o valor do lance de sequência `2` direto na tabela `bids`:
   ```bash
   docker exec -it leilao_verzel_db psql -U postgres -d leilao_verzel -c "UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2;"
   ```
4. Volte para a página de auditoria no navegador e clique em `Reexecutar auditoria`.
5. O verificador acusará quebra na sequência `#2` (`is_chain_valid: false`) e exibirá a diferença entre o hash gravado no banco e o hash recalculado.

## 7. Execução dos testes automatizados

Para rodar a suíte do backend (47 testes com Pytest):
```bash
python -m pytest backend/tests -v
```

Para rodar os testes unitários do frontend (formatação em centavos e cálculo do cronômetro regressivo e janela anti-sniping):
```bash
cd frontend
npm test
```

## 8. Uso de inteligência artificial no projeto

Neste projeto, utilizei a IA para acelerar a escrita de código repetitivo, concentrando o suporte dos modelos na geração de estruturas básicas, massa de testes e tipagens. As decisões de arquitetura, consistência transacional e regras de negócio permaneceram sob controle manual direto.

### Onde a IA acelerou o desenvolvimento
- Estruturação inicial de schemas Pydantic v2, DTOs e tipagens em TypeScript alinhados às entidades do banco e aos contratos de API.
- Criação das fixtures do Pytest (usando `aiosqlite`) e casos de borda para os 47 testes unitários do backend, além dos testes de formatação no frontend.
- Prototipação dos blocos visuais e classes utilitárias em Tailwind CSS para os temas claro e escuro.

### Falhas do modelo e correções aplicadas
- Concorrência e deadlocks: ao gerar o fluxo de lances, a IA sugeriu comandos `UPDATE` sem isolamento transacional, o que gerava condições de corrida com saldo negativo e lances sobrepostos. A solução foi reescrever a rotina usando `SELECT ... FOR UPDATE` no PostgreSQL e ordenar os IDs das carteiras (`involved_user_ids = sorted(...)`), evitando deadlocks clássicos de concorrência mútua (disputa AB-BA).
- Resiliência na API externa: a API do Art Institute of Chicago retornava erros HTTP 403 por bloqueios da Cloudflare durante testes automatizados. Como a IA sugeriu apenas subir o timeout, migrei a integração para o Cleveland Museum of Art (Open Access) e criei uma contingência local em memória com vetores SVG caso o serviço fique instável.
- Cálculo de extensão anti-sniping: a IA definiu a prorrogação resetando o prazo para o horário atual mais 120 segundos. Como a regra exigia extensão cumulativa, ajustei o cálculo para somar 120 segundos ao término que já estava vigente (`lot.end_time += 120s`), preservando os segundos residuais.
- Encerramento de lotes: para evitar um worker contínuo em background consumindo recursos no plano gratuito do Render, optei por liquidação sob demanda (*lazy settlement*). O fechamento é processado de forma atômica no momento em que o lote é consultado ou recebe um novo lance.
- Resiliência em WebSockets: a rotina sugerida não tratava quedas de rede. Foi implementada reconexão no cliente com recuo exponencial (*exponential backoff*) e *jitter* aleatório para evitar sobrecarga simultânea (*thundering herd*) no servidor.
- Integridade da cadeia criptográfica: a validação da cadeia de hashes precisou ser ajustada para detectar não apenas alterações nos lances, mas também remoções no meio ou no topo da fila, comparando o elo final com o `head_hash` e o `bid_count` gravados no lote.
