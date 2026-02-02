import { Streamdown } from "streamdown";
import type { ComponentProps } from "react";

const STREAMDOWN_COMPONENTS: ComponentProps<typeof Streamdown>["components"] = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  ),
  img: ({ src, alt, ...props }) => (
    <img src={src ?? ""} alt={alt ?? ""} loading="lazy" {...props} />
  )
};

type ChatMarkdownProps = {
  content: string;
};

export default function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <Streamdown
      mode="static"
      className="chat-markdown"
      components={STREAMDOWN_COMPONENTS}
      controls={{ code: true, table: false, mermaid: false }}
      shikiTheme={["github-light", "github-light"]}
    >
      {content}
    </Streamdown>
  );
}
