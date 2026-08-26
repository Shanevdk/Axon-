---
paths:
  - 'app/Http/Responses/**'
---

# Responses

## First sign-in lands on the front page, later ones on the studio
`LoginResponse` and `RegisterResponse` are bound in `FortifyServiceProvider::register()` and both defer to the `SendsUserHome` trait. It calls `User::recordSignIn()`, which stamps `users.signed_in_at` and returns whether that was the first arrival: first goes to `route('home')`, every later one to `config('fortify.home')`. `redirect()->intended()` still wins, so an invitation link is honoured either way.

`signed_in_at` null means never arrived, so existing accounts get the introduction once. Do not point `fortify.home` at `/` to "fix" a redirect — that breaks the distinction.

`pages/welcome.tsx` has two states off `auth.user`: the pitch for visitors, and a welcome with first steps for someone who has just registered. Both are rendered by the same `welcome` component, so keep them in that one file.
