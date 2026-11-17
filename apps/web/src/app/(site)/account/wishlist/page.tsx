import { redirect } from "next/navigation";
import { connection } from "next/server";
import { wishlist } from "@namilux/core";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { AccountEmpty } from "@/components/account/AccountEmpty";
import { ProductGrid } from "@/components/plp/ProductGrid";
export default async function AccountWishlistRoute(): Promise<React.ReactNode> {
    // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
    await connection();
    const user = await currentUser();
    if (user === null)
        redirect("/account/login/?next=/account/wishlist/");
    const cards = await wishlist.cards(db, user.customerId);
    if (cards.length === 0) {
        return (<AccountEmpty icon="heart" title="account.wishlist.empty" body="account.wishlist.empty.body"/>);
    }
    return <ProductGrid items={cards}/>;
}
