"use client";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/state/theme";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

/**
 * One button, two states: the moon on a light page, the sun on a dark one. The effective scheme is
 * read from <html> - the pre-paint script and the theme store both write it there - so a visitor
 * on "system" sees the icon for what their device chose. The row variant sits in the menu list.
 */
export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "row" }): React.ReactNode {
  const { setTheme } = useTheme();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = (): void => {
      setDark(root.classList.contains("dark"));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, []);

  const label = t(dark ? "shell.theme.light" : "shell.theme.dark");
  const toggle = (): void => {
    setTheme(dark ? "light" : "dark");
  };

  if (variant === "row") {
    return (
      <button type="button" className="menu__row" onClick={toggle} aria-pressed={dark}>
        <Icon name={dark ? "sun" : "moon"} size={20} />
        {label}
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      <Icon name={dark ? "sun" : "moon"} size={20} />
    </button>
  );
}
