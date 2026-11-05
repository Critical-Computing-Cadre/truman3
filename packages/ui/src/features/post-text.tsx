import { textPieces } from "@truman3/core";
import { createContext, type ReactNode, useContext } from "react";
import { useFeature } from "../platform.tsx";

export interface TextLinks {
  renderTag: (tag: string, children: ReactNode) => ReactNode;
  renderMention: (username: string, children: ReactNode) => ReactNode;
}

/** How to link a hashtag or mention. Without this, as in a preview, they're plain text. */
export const TextLinksContext = createContext<TextLinks | null>(null);

/** What someone wrote, with hashtags and mentions linked on a platform that has them. */
export function PostText({ text }: { text: string }) {
  const hashtags = useFeature("hashtags");
  const mentions = useFeature("mentions");
  const links = useContext(TextLinksContext);
  if (!links || (!hashtags && !mentions)) {
    return <>{text}</>;
  }
  return (
    <>
      {textPieces(text, { hashtags, mentions }).map((piece, index) => {
        const key = `${index}-${piece.text}`;
        if (piece.type === "tag") {
          return <span key={key}>{links.renderTag(piece.tag, piece.text)}</span>;
        }
        if (piece.type === "mention") {
          return <span key={key}>{links.renderMention(piece.username, piece.text)}</span>;
        }
        return <span key={key}>{piece.text}</span>;
      })}
    </>
  );
}
