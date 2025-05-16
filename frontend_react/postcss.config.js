// export default {
//   plugins: {
//     tailwindcss: {},
//     autoprefixer: {},
//   },
// }

import autoprefixer from 'autoprefixer';
import tailwindcss from '@tailwindcss/postcss';

export default {
  plugins: [tailwindcss, autoprefixer],
};