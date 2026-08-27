/**
 * Remplaçant de `server-only` pour les tests.
 *
 * Le vrai paquet lève une erreur dès qu'il est importé hors d'un contexte
 * serveur, ce qui empêcherait de tester les modules serveur. La protection
 * réelle reste assurée au build par Next.js.
 */
export {};
