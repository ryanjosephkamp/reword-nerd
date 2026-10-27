import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"browser.spec.ts",timeout:120000,workers:1,retries:0,outputDir:`../../output/studio/collections/browser/results-${Date.now()}`,reporter:"list",use:{actionTimeout:10000,...devices["Desktop Chrome"],viewport:{width:1440,height:1000},screenshot:"only-on-failure",trace:"retain-on-failure"}});
