# farmacia-solidaria-pet
Protótipo web para doação e solicitação de medicamentos veterinários da Farmácia Solidária Pet.

## Supabase

Cadastro, login, sessões e perfis são armazenados no Supabase Auth e PostgreSQL. Configure o ambiente local:

```sh
cp .env.example .env
npm install
```

No painel do Supabase, abra **SQL Editor** e execute [`data/schema.supabase.sql`](./data/schema.supabase.sql). O script cria a tabela `profiles`, ativa RLS, permite que cada pessoa consulte e atualize somente o próprio perfil e cria o perfil automaticamente durante o cadastro. Também cria `partners`, que aceita solicitações públicas apenas com estado `pending` e permite leitura pública somente dos campos não sensíveis dos parceiros aprovados.

O arquivo `.env.example` contém a URL do projeto e a chave pública `anon` fornecidas para este site. Inicie o servidor:

```sh
npm start
```

Abra `http://localhost:3000`. A aplicação usa o servidor como intermediário e guarda os tokens de sessão em cookies `HttpOnly`. Não configure nem exponha uma chave `service_role`.

Em **Authentication → URL Configuration**, configure o endereço do site e permita a URL de recuperação definida em `SUPABASE_RECOVERY_REDIRECT_URL` (localmente, `http://localhost:3000/recuperar-senha.html`; ajuste para o domínio publicado). A confirmação de e-mail pode ser habilitada em **Authentication → Providers → Email**. O envio de confirmação e recuperação depende da configuração de e-mail/SMTP do projeto.

## Publicar na Vercel

Importe este repositório na Vercel. As páginas HTML/CSS são servidas como arquivos estáticos e `api/[...path].mjs` atende às rotas da API. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_RECOVERY_REDIRECT_URL` nas variáveis de ambiente de Production, Preview e Development e execute o SQL acima no projeto Supabase antes de publicar.

O banco MySQL antigo não é migrado automaticamente. Contas existentes precisam ser migradas para o Supabase Auth ou cadastradas novamente.

## Páginas do site

O menu inicial dá acesso às páginas de história, ONGs, clínicas, privacidade e painel da conta. Nas páginas de ONGs e clínicas, organizações podem enviar uma solicitação pública de cadastro. As solicitações ficam pendentes e não são exibidas até aprovação manual. Contatos de e-mail e telefone são armazenados para análise pela equipe, mas não são publicados.

Para analisar solicitações, abra **Table Editor → partners** no Supabase. E-mail e telefone ficam privados e não são incluídos na consulta pública. Confira os dados e altere `status` para `approved` para publicar o parceiro, ou `rejected` para recusá-lo. Nunca dê permissões de atualização dessa tabela à função `anon`. O texto de privacidade é inicial e deve ser revisado pela equipe responsável antes da publicação definitiva.

Depois de atualizar o esquema com a tabela `partners`, execute novamente o conteúdo completo de [`data/schema.supabase.sql`](./data/schema.supabase.sql) no SQL Editor do Supabase. As instruções são idempotentes e aplicam as permissões necessárias.
