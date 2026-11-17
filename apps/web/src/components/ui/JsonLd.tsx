import { serializeJsonLd } from "@namilux/core";
// One of the two sanctioned HTML sinks. `serializeJsonLd` escapes `<`, `>`, `&` and the two line
// separators, so a `</script` sequence can never come out of a database string. `application/ld+json`
// is a data block, not an executable script, so CSP script-src does not apply and no nonce is needed.
export function JsonLd({ data }: {
    data: object;
}): React.ReactNode {
    const json = serializeJsonLd(data);
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }}/>;
}
