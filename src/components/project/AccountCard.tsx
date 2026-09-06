"use client";

import { useState } from "react";

import type { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, textInputClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { SyncBadge } from "@/components/project/SyncBadge";

/**
 * Connexion et déconnexion.
 *
 * Quand l'authentification n'est pas configurée, on ne montre pas un formulaire
 * qui ne pourrait pas fonctionner : on explique l'état réel et la conséquence
 * — les données restent sur cet appareil.
 */
export function AccountCard({
  workspace,
}: {
  workspace: ReturnType<typeof useProjectWorkspace>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    const ok = await workspace.signIn(email.trim(), password);
    setBusy(false);
    if (ok) setPassword("");
  }

  if (!workspace.authAvailable) {
    return (
      <Section step="0" title="Compte" description="Mémoire durable non configurée.">
        <SyncBadge state="local-only" />
        <p className="mt-3 text-sm text-muted">
          La connexion n&apos;est pas activée sur ce serveur. L&apos;application fonctionne,
          mais tout est stocké dans ce navigateur : rien ne suivra sur un autre appareil.
        </p>
        <p className="mt-2 text-xs text-muted">
          Pour activer la mémoire partagée, suivez <code>docs/memoire-et-budget.md</code>.
        </p>
      </Section>
    );
  }

  if (workspace.session !== null) {
    return (
      <Section step="0" title="Compte">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {workspace.session.email ?? "Compte connecté"}
            </p>
            <p className="mt-1">
              <SyncBadge state={workspace.syncState} compact />
            </p>
          </div>
          <Button variant="secondary" onClick={() => void workspace.signOut()}>
            Se déconnecter
          </Button>
        </div>

        {workspace.error ? (
          <div className="mt-3">
            <Alert tone="error">{workspace.error}</Alert>
          </div>
        ) : null}
      </Section>
    );
  }

  return (
    <Section
      step="0"
      title="Connexion"
      description="Connectez-vous pour retrouver vos projets sur tous vos appareils."
    >
      <SyncBadge state="local-only" />

      <div className="mt-3 flex flex-col gap-3">
        <Field label="Adresse e-mail">
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={textInputClasses()}
            aria-label="Adresse e-mail"
          />
        </Field>
        <Field label="Mot de passe">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={textInputClasses()}
            aria-label="Mot de passe"
          />
        </Field>

        {workspace.error ? <Alert tone="error">{workspace.error}</Alert> : null}

        <Button
          variant="primary"
          onClick={() => void handleSignIn()}
          disabled={busy || email.trim().length === 0 || password.length === 0}
        >
          {busy ? "Connexion…" : "Se connecter"}
        </Button>
        <p className="text-xs text-muted">
          Les comptes sont créés par le propriétaire depuis le tableau de bord Supabase.
          L&apos;inscription libre est volontairement désactivée : elle donnerait accès au
          crédit de génération.
        </p>
      </div>
    </Section>
  );
}
