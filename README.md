# farmacia-solidaria-pet
Protótipo web para doação e solicitação de medicamentos veterinários da Farmácia Solidária Pet.

## MySQL local

Requisitos: Node.js 22.13 ou superior e Docker Compose. Configure o ambiente e inicie o MySQL:

```sh
cp .env.example .env
npm install
npm run db:up
```

O banco fica em um volume Docker persistente. Para migrar os cadastros do SQLite antigo, execute `npm run db:migrate-sqlite` uma vez, antes de iniciar a aplicação. A migração preserva IDs, hashes de senha e sessões; ela exige que o banco MySQL ainda não tenha usuários.

Inicie a aplicação:

```sh
npm start
```

Abra `http://localhost:3000`. O servidor cria as tabelas automaticamente. As configurações de conexão estão no `.env` e podem ser alteradas conforme o MySQL local.

O cadastro, login, sessão e perfil usam o MySQL. A recuperação por e-mail depende de um serviço de envio que não está configurado neste protótipo local.

## Publicar na Vercel

Importe este repositório na Vercel. As páginas HTML/CSS são servidas como arquivos estáticos e `api/[...path].mjs` atende às rotas da API.

No projeto da Vercel, configure `MYSQL_URL` com a URL pública do MySQL no Railway. Configure `MYSQL_SSL=true` se o endpoint do Railway exigir TLS. Não use a URL privada `*.railway.internal`, pois ela não é acessível pela Vercel. A função cria as tabelas na primeira requisição; para preservar cadastros já existentes, importe-os para o banco Railway antes de publicar.

Cada ambiente Vercel (Production, Preview e Development) precisa de suas próprias variáveis MySQL. Depois de importar o repositório e definir as variáveis, faça o deploy pelo painel ou envie um novo commit para a branch conectada.
