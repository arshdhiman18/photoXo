export function FieldError({ messages, id }: { messages?: string[]; id?: string }) {
  if (!messages?.length) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {messages[0]}
    </p>
  );
}
