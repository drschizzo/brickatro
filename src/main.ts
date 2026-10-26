import './ui/style.css';
import { Game } from './game';

const game = new Game(document.getElementById('c') as HTMLCanvasElement);
// Accès debug en dev (console : __game)
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
