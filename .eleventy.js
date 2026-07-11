module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ assets: "assets" });
  eleventyConfig.addPassthroughCopy({ "styles.css": "styles.css" });
  eleventyConfig.addPassthroughCopy({ "script.js": "script.js" });
  // Админ-панель (Sveltia CMS): копируем как есть, без обработки шаблонизатором.
  eleventyConfig.addPassthroughCopy({ admin: "admin" });

  eleventyConfig.addFilter("json", (value) => JSON.stringify(value, null, 2));

  // Абсолютный URL: добавляет базовый адрес, если путь относительный.
  eleventyConfig.addFilter("absUrl", (path, base) => {
    if (!path) return path;
    return String(path).startsWith("http") ? path : (base || "") + path;
  });

  // Разметка FAQ (schema.org/FAQPage) из данных faq.json.
  eleventyConfig.addFilter("faqLd", (items) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: (items || []).map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  }));

  // Разметка товара (schema.org/Product) из данных страницы продукта.
  eleventyConfig.addFilter("productLd", (o) => {
    o = o || {};
    const ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: o.name,
      description: o.description,
    };
    if (o.image) ld.image = o.image;
    const price = String(o.price || "").replace(/[^0-9]/g, "");
    if (price) {
      ld.offers = {
        "@type": "Offer",
        price,
        priceCurrency: "RUB",
        availability: "https://schema.org/InStock",
        url: o.url,
      };
    }
    return ld;
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
