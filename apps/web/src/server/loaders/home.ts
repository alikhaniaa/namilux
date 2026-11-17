import "server-only";
import { getHomeData, tags } from "@namilux/core";
import type { HomeData } from "@namilux/core";
import { tagCatalog } from "@/lib/cache";
import { db } from "@/lib/db";
// One entry for the whole homepage: every module on it is revalidated by the same events (a price
// edit, a banner going live, a post publishing), so splitting it would multiply the tag bookkeeping
// without ever letting one module go stale alone.
export async function loadHome(): Promise<HomeData> {
    "use cache";
    tagCatalog([tags.home, tags.content], "minutes");
    return await getHomeData(db);
}
