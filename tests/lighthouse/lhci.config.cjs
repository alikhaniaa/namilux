module.exports = {
  ci: {
    collect: { url: [process.env.LH_ORIGIN + "/", process.env.LH_ORIGIN + "/shop/", process.env.LH_ORIGIN + "/product/" + (process.env.LH_PRODUCT_SLUG || "") + "/", process.env.LH_ORIGIN + "/billing/"], numberOfRuns: 3, settings: { formFactor: "mobile", screenEmulation: { mobile: true, width: 360, height: 780, deviceScaleFactor: 3 }, throttling: { rttMs: 150, throughputKbps: 1638, cpuSlowdownMultiplier: 4 }, budgetPath: "./budgets.json" } },
    assert: { assertions: { "categories:accessibility": ["error", { minScore: 1 }], "categories:best-practices": ["error", { minScore: 1 }], "categories:seo": ["error", { minScore: 1 }], "performance-budget": "error" } },
    upload: { target: "filesystem", outputDir: "./out" },
  },
};
