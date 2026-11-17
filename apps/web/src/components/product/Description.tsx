import { RichHtml } from "@/components/ui/RichHtml";
import { DescriptionToggle } from "./DescriptionToggle";

export function Description({ html }: { html: string }): React.ReactNode {
  if (html.trim() === "") return null;

  // The full sanitized body is server-rendered. A closed <details> hides even the preview;
  // the client wrapper instead clamps visually and leaves all content readable without JS.
  return (
    <DescriptionToggle><RichHtml html={html} /></DescriptionToggle>
  );
}
