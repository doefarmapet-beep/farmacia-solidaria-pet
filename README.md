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
