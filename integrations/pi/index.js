// relay's pi extension: pi loads this file and calls its factory once per session and per reload.
import { bind } from './binding.js';

// pi's SDK loads extensions into other programs too, which have no pi process for a row to name.
const PI_TITLES = ['pi', 'pi-rpc'];

export default function relay(pi) { if (PI_TITLES.includes(process.title)) bind(pi); }
