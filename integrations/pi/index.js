// relay's pi extension: pi loads this file and calls its factory once per session and per reload.
import { bind } from './binding.js';

export default function relay(pi) { bind(pi); }
