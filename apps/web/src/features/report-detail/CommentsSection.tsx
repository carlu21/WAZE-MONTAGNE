import { useState } from "react";
import { Send } from "lucide-react";
import { fr, type ReportComment } from "@mountain-live/core";
import { Avatar, Button, RelativeTime, Textarea } from "@/components/ui";

export interface CommentsSectionProps {
  comments: ReportComment[];
  canComment: boolean;
  pending?: boolean;
  onSubmit: (body: string) => void;
  onRequireLogin: () => void;
  /** Ouvre la zone de saisie (ex. depuis l'action « Commenter »). */
  composeOpen: boolean;
  onComposeOpen: (v: boolean) => void;
}

export function CommentsSection({ comments, canComment, pending = false, onSubmit, onRequireLogin, composeOpen, onComposeOpen }: CommentsSectionProps) {
  const [text, setText] = useState("");
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    onSubmit(body);
    setText("");
  };
  return (
    <section aria-labelledby="comments-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="comments-title" className="text-[16px] font-bold text-fg">
          {fr.sheet.comments} {comments.length ? `(${comments.length})` : ""}
        </h2>
        {!composeOpen ? (
          <Button size="md" variant="ghost" onClick={() => (canComment ? onComposeOpen(true) : onRequireLogin())}>
            {fr.sheet.actions.comment}
          </Button>
        ) : null}
      </div>
      {comments.length === 0 ? <p className="text-[14px] text-muted">{fr.sheet.noComments}</p> : null}
      <ul className="flex flex-col gap-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <Avatar name={c.authorPseudo} size={40} />
            <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted">
                <span className="font-semibold text-fg">{c.authorPseudo}</span>
                <RelativeTime date={c.createdAt} />
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug text-fg">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {composeOpen ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={fr.sheet.commentPlaceholder} maxLength={600} aria-label={fr.sheet.actions.comment} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="md" type="button" onClick={() => onComposeOpen(false)}>
              {fr.common.cancel}
            </Button>
            <Button size="md" type="submit" leftIcon={<Send />} loading={pending} disabled={!text.trim()}>
              {fr.common.send}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
