import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'output/studio/image-companion-cache/vitest',test:{environment:'node',include:['image-companion/**/*.test.ts'],maxWorkers:2,testTimeout:15000}});
