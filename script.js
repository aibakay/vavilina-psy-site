const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");

menuButton?.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
    menuButton?.setAttribute("aria-label", "Открыть меню");
  });
});

nav?.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && nav.classList.contains("is-open")) {
    nav.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
    menuButton?.setAttribute("aria-label", "Открыть меню");
    menuButton?.focus();
  }
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));

const mobileStickyCta = document.querySelector(".mobile-sticky-cta");
const heroSection = document.querySelector(".hero");
const mobileStickyQuery = window.matchMedia("(max-width: 768px)");
let heroHeight = heroSection?.offsetHeight ?? 0;
let stickyCtaTicking = false;

const updateMobileStickyCta = () => {
  if (!mobileStickyCta || !heroSection) {
    return;
  }

  const shouldShow = mobileStickyQuery.matches && window.scrollY > heroHeight * 0.72;

  mobileStickyCta.classList.toggle("is-visible", shouldShow);
};

const requestStickyCtaUpdate = () => {
  if (stickyCtaTicking) {
    return;
  }

  stickyCtaTicking = true;
  window.requestAnimationFrame(() => {
    updateMobileStickyCta();
    stickyCtaTicking = false;
  });
};

const refreshHeroHeight = () => {
  heroHeight = heroSection?.offsetHeight ?? 0;
  updateMobileStickyCta();
};

updateMobileStickyCta();
window.addEventListener("scroll", requestStickyCtaUpdate, { passive: true });
window.addEventListener("resize", refreshHeroHeight);

const processedReviewCards = new WeakSet();

const setupReviewCard = (card) => {
  if (processedReviewCards.has(card)) {
    return;
  }

  const text = card.querySelector("p");

  if (!text) {
    return;
  }

  card.classList.add("is-collapsible");

  const isOverflowing = text.scrollHeight > text.clientHeight + 1;

  if (!isOverflowing) {
    card.classList.remove("is-collapsible");
    processedReviewCards.add(card);
    return;
  }

  const button = document.createElement("button");
  button.className = "review-toggle";
  button.type = "button";
  button.textContent = "Читать полностью";

  button.addEventListener("click", () => {
    const expanded = card.classList.toggle("is-expanded");
    button.textContent = expanded ? "Свернуть" : "Читать полностью";
  });

  card.append(button);
  processedReviewCards.add(card);
};

document.querySelectorAll(".review-card").forEach((card) => {
  if (card.closest(".review-group[hidden]")) {
    return;
  }

  setupReviewCard(card);
});

const reviewTabs = document.querySelectorAll("[data-review-tab]");
const reviewGrids = document.querySelectorAll(".review-grid");
const scrollbarUpdaters = new WeakMap();

reviewGrids.forEach((grid) => {
  const scrollbar = document.createElement("div");
  const thumb = document.createElement("span");

  scrollbar.className = "review-scrollbar";
  scrollbar.setAttribute("aria-hidden", "true");
  scrollbar.append(thumb);
  grid.after(scrollbar);

  const updateScrollbar = () => {
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    const trackWidth = scrollbar.clientWidth;

    if (maxScroll <= 0 || trackWidth <= 0) {
      scrollbar.hidden = true;
      return;
    }

    scrollbar.hidden = false;

    const thumbWidth = Math.max(46, Math.round((grid.clientWidth / grid.scrollWidth) * trackWidth));
    const maxThumbOffset = trackWidth - thumbWidth;
    const thumbOffset = Math.round((grid.scrollLeft / maxScroll) * maxThumbOffset);

    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${thumbOffset}px)`;
  };

  grid.addEventListener("scroll", updateScrollbar, { passive: true });
  window.addEventListener("resize", updateScrollbar);

  scrollbar.addEventListener("click", (event) => {
    const rect = scrollbar.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const maxScroll = grid.scrollWidth - grid.clientWidth;

    grid.scrollTo({
      left: Math.max(0, Math.min(maxScroll, ratio * maxScroll)),
      behavior: "smooth",
    });
  });

  updateScrollbar();
  scrollbarUpdaters.set(grid, updateScrollbar);
});

const reviewTabsList = Array.from(reviewTabs);

const activateReviewTab = (tab, { focus = false } = {}) => {
  const targetId = tab.dataset.reviewTab;

  reviewTabsList.forEach((item) => {
    const active = item === tab;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll(".review-group[role='tabpanel']").forEach((panel) => {
    panel.hidden = panel.id !== targetId;
  });

  const targetPanel = document.getElementById(targetId);
  targetPanel?.querySelectorAll(".review-card").forEach(setupReviewCard);

  const targetGrid = targetPanel?.querySelector(".review-grid");
  if (targetGrid) {
    scrollbarUpdaters.get(targetGrid)?.();
  }

  if (focus) {
    tab.focus();
  }
};

reviewTabsList.forEach((tab) => {
  tab.addEventListener("click", () => activateReviewTab(tab));

  tab.addEventListener("keydown", (event) => {
    const currentIndex = reviewTabsList.indexOf(tab);
    let nextIndex = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % reviewTabsList.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + reviewTabsList.length) % reviewTabsList.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = reviewTabsList.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      activateReviewTab(reviewTabsList[nextIndex], { focus: true });
    }
  });
});
