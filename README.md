# B2B Anywhere

Mesa de DJ no navegador para tocar **B2B sincronizado pela internet**: 4 decks com BPM, grid e SYNC estilo CDJ, mixer de clube com Sound Color FX e Beat FX, salas com código, cadastro e chat.

> Para testar sem configurar nada, rode `npx serve .` na pasta e abra em duas abas (modo demonstração).

---

## Guia de publicação

Mesa de DJ com 4 decks e mixer para tocar B2B pela internet. Cada pessoa cria a própria conta, uma delas cria a sala e as outras entram com o código.

## Como funciona

- **Contas, salas e músicas** ficam no **Supabase**, que é o banco de dados e o armazenamento. O plano gratuito serve para começar.
- **O site** é estático, só HTML, CSS e JavaScript, sem precisar de build. Dá para publicar no **Netlify**, na **Vercel** ou em qualquer hospedagem.
- **Sincronização:** quando um DJ carrega uma música, ela sobe para a nuvem e todos da sala baixam. Cada comando (play, cue, tempo, SYNC, faders, efeitos) é enviado com o horário do servidor. Cada computador toca a mixagem localmente, e por isso as faixas ficam alinhadas na batida para todos, em qualquer lugar.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | telas: login, salas e a mesa |
| `styles.css` | visual |
| `app.js` | a mesa, o sync e a sala |
| `net.js` | conexão com o Supabase (e o modo demonstração) |
| `config.js` | **onde você cola a URL e a chave do Supabase** |
| `supabase/setup.sql` | estrutura do banco: rode uma vez no Supabase |

## Passo 0 — Testar antes de publicar (opcional)

Com o `config.js` vazio, o site abre no **modo demonstração**: tudo fica salvo no próprio navegador.

1. Na pasta, rode `npx serve .` (ou `python -m http.server`) e abra o endereço que aparecer.
2. Crie uma conta e uma sala, depois abra **outra aba** no mesmo endereço.
3. Na segunda aba, crie outra conta e entre com o código. Uma aba controla a outra.

## Passo 1 — Criar o projeto no Supabase

1. Entre em https://supabase.com e crie uma conta.
2. Clique em **New project**, escolha um nome e uma senha do banco. Em região, use **South America (São Paulo)**.
3. Espere uns 2 minutos até o projeto ficar pronto.

## Passo 2 — Criar o banco

1. No menu lateral, abra **SQL Editor** → **New query**.
2. Cole todo o conteúdo de `supabase/setup.sql` e clique em **Run**.
3. Deve aparecer *Success. No rows returned*.

O script cria as tabelas de perfis e salas, as regras de segurança (cada um só vê as salas em que entrou), a pasta `tracks` para as músicas e os canais de tempo real privados de cada sala.

## Passo 3 — Ajustar o login

Em **Authentication → Sign In / Providers → Email**:

- **Confirm email:** se ficar ligado, a pessoa precisa clicar no link que chega por e-mail antes de entrar. Para testes, pode desligar.

Em **Authentication → URL Configuration**:

- **Site URL:** coloque o endereço onde o site vai ficar (por exemplo `https://cabine-online.netlify.app`). Faça isso depois do Passo 5.

> O Supabase grátis só envia poucos e-mails por hora. Para muitos usuários, configure um SMTP próprio em **Authentication → Emails → SMTP Settings**.

## Passo 4 — Colar as chaves no `config.js`

Em **Project Settings → API** (ou no botão **Connect**), copie:

- **Project URL** → `SUPABASE_URL`
- **anon public** (ou *publishable key*) → `SUPABASE_ANON_KEY`

```js
window.CABINE_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

A chave *anon/publishable* é feita para ficar no site. **Nunca** use a `service_role`/*secret key* aqui.

## Passo 5 — Publicar o site

**Opção mais fácil — Netlify Drop**

1. Abra https://app.netlify.com/drop e faça login.
2. Arraste a **pasta inteira** do projeto para a página.
3. Pronto: ele gera um endereço `https://algum-nome.netlify.app`. Dá para trocar o nome em *Site configuration*.

**Vercel**

1. Suba a pasta para um repositório no GitHub.
2. Em https://vercel.com → **Add New → Project** → importe o repositório → **Deploy**. Não precisa configurar nada.

Depois volte ao Passo 3 e coloque esse endereço em **Site URL**.

## Usando

1. Cada pessoa abre o site e clica em **CRIAR CONTA**.
2. Uma pessoa cria a sala e clica em **CONVITE** para copiar o link.
3. Quem recebe o link entra, faz login e clica em **ENTRAR NA SALA** (como DJ ou espectador).
4. Os DJs carregam músicas, e todos da sala ouvem a mesma mixagem.

- **MEU VOLUME** (embaixo) muda só o que você ouve. O **MASTER** do mixer muda para todos.
- **Espectadores** ouvem tudo, mas não mexem na mesa.

## Limites do plano gratuito do Supabase (aproximados)

- **1 GB de armazenamento:** cerca de 100 músicas em mp3. Apague salas antigas para liberar espaço.
- **5 GB de transferência por mês:** cada pessoa da sala baixa cada música uma vez.
- **Arquivos de até 50 MB** cada.
- **Projeto pausado após 1 semana sem uso:** reative no painel.

Para uso maior, o plano Pro custa cerca de US$ 25/mês.

## Direitos das músicas

As músicas enviadas ficam guardadas na sua conta do Supabase e são baixadas por quem está na sala. Para tocar entre amigos, tudo bem. Para abrir ao público ou transmitir, verifique os direitos de execução das faixas.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "SEM CONEXÃO" na sala | Confira se o `setup.sql` rodou inteiro (inclusive a parte de tempo real) e se as chaves do `config.js` estão certas. |
| "Confirme o seu e-mail" | Clique no link do e-mail ou desligue **Confirm email** no Supabase. |
| Música não sobe | Limite de 50 MB, ou o formato não é áudio. |
| Link de confirmação abre localhost | Ajuste **Site URL** no Supabase (Passo 3). |
| Abre no modo demonstração | O `config.js` está vazio ou o endereço tem `?demo` no final. |
