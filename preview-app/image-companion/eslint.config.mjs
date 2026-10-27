import base from '../eslint.config.js';
import globals from 'globals';
export default [...base,{files:['**/*.{ts,mjs}'],languageOptions:{globals:globals.node}}];
