# Configuração do álbum online

As fotos em `fotos/` são incluídas no site publicado e ficam visíveis para quem abrir o livro. As lembranças cadastradas pelo navegador precisam ser migradas para o Supabase para aparecerem em outros dispositivos.

## Preparar o Supabase

1. Crie um projeto no Supabase.
2. Em **Authentication → Users**, crie o usuário editor com o e-mail que será configurado em `editorEmail`. Use uma senha forte; não use `2015` em um site público.
3. No **SQL Editor**, execute todo o arquivo `supabase-setup.sql`.
4. No SQL Editor, autorize somente o usuário editor, substituindo o e-mail pelo endereço usado no passo anterior:

```sql
insert into public.book_editors (user_id)
select id from auth.users where email = 'SEU-EMAIL-EDITOR'
on conflict (user_id) do nothing;
```

5. Em **Project Settings → API**, copie a Project URL e a chave **publishable** (ou `anon` legada). Nunca use `service_role` ou outra chave secreta no site.
6. Preencha `supabase-config.js`:

```js
window.BOOK_SUPABASE = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_CHAVE_PUBLICA",
  editorEmail: "email-do-usuario-editor"
};
```

O nome de login continua sendo `b+f`; a senha é a senha definida para esse usuário no Supabase. O login anterior `2015` não é enviado para o projeto nem incorporado ao código.

## Publicar e migrar

1. Publique novamente o projeto no GitHub Pages.
2. Abra o livro no navegador/dispositivo onde as lembranças antigas foram cadastradas e entre em **Editar livro**.
3. Clique em **Importar lembranças deste dispositivo** e aguarde a confirmação. O processo não apaga os dados locais.

A migração deve ser iniciada em cada navegador que contenha lembranças locais. As fotos do diretório `fotos/` já fazem parte do site; as fotos adicionadas pelo formulário são enviadas ao bucket público `book-photos`.

O livro é público para leitura e suas fotos também serão públicas. O acesso de edição é controlado pela autenticação do Supabase e pelas políticas RLS criadas no SQL.
