import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le build fonctionne à la racine d'un domaine comme dans un sous-dossier (GitHub Pages)
  base: './',
});
