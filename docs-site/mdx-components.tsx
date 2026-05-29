import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import type { MDXComponents } from "mdx/types";

/**
 * Central place to extend the MDX component set. Pages call this so any custom
 * components (callouts, tabs, cards, steps from fumadocs-ui) are available in
 * every doc without an explicit import in each MDX file.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tab,
    Tabs,
    Callout,
    Card,
    Cards,
    Step,
    Steps,
    ...components,
  };
}
