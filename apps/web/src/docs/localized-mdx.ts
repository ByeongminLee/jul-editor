import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Locale } from "./nav.js";

// MDX content is authored as one file per language: <slug>/en.mdx and <slug>/ko.mdx.
// Each language is its own lazy chunk; a missing file falls back to the other language.
export type MdxModule<Meta = unknown> = { default: ComponentType<{ components?: Record<string, unknown> }>; meta?: Meta };
export type MdxLoader<Meta = unknown> = () => Promise<MdxModule<Meta>>;
export type MdxSources<Meta = unknown> = Record<Locale, Record<string, MdxLoader<Meta>>>;

type LazyMdx = LazyExoticComponent<ComponentType<{ components?: Record<string, unknown> }>>;
const lazyCache = new WeakMap<MdxLoader<never>, LazyMdx>();

/** Resolve the loader for a slug and locale, falling back to the other language. */
export function resolveMdx<Meta>(sources: MdxSources<Meta>, locale: Locale, key: string): { loader: MdxLoader<Meta>; locale: Locale } | undefined {
  const other: Locale = locale === "en" ? "ko" : "en";
  const first = sources[locale][key];
  if (first) return { loader: first, locale };
  const second = sources[other][key];
  return second ? { loader: second, locale: other } : undefined;
}

/** One stable lazy component per loader, so switching language back and forth does not remount through a fresh promise. */
export function lazyMdx<Meta>(loader: MdxLoader<Meta>): LazyMdx {
  let component = lazyCache.get(loader as MdxLoader<never>);
  if (!component) {
    component = lazy(loader as MdxLoader<never>) as unknown as LazyMdx;
    lazyCache.set(loader as MdxLoader<never>, component);
  }
  return component;
}

/** Warm the other language so the toggle swaps content without a network wait. */
export function prefetchMdx<Meta>(sources: MdxSources<Meta>, locale: Locale, key: string): void {
  const hit = resolveMdx(sources, locale, key);
  void hit?.loader();
}
