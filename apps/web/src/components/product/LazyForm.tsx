"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

const ReviewForm = dynamic(() => import("./ReviewForm").then((m) => m.ReviewForm), { ssr: false });
const QuestionForm = dynamic(() => import("./QuestionForm").then((m) => m.QuestionForm), { ssr: false });

export function LazyForm({ kind, productId }: { kind: "review" | "question"; productId: number }): React.ReactNode {
  const [open, setOpen] = useState(false);
  const label = kind === "review" ? t("product.reviews.write") : t("product.questions.ask");
  if (!open) {
    return (
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {label}
        </Button>
      </div>
    );
  }
  return kind === "review" ? <ReviewForm productId={productId} /> : <QuestionForm productId={productId} />;
}
