import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MessageActionRowComponentBuilder,
  MessageFlags,
  MessageMentionOptions,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} from "discord.js";
import { Colors, Icons } from "./theme";

/** Any top-level component allowed in a Components V2 message. */
export type V2Component =
  | ContainerBuilder
  | TextDisplayBuilder
  | ActionRowBuilder<MessageActionRowComponentBuilder>;

type Line = string | false | null | undefined;

/** Discord caps a single Text Display at 4000 characters. */
const TEXT_LIMIT = 4000;

function joinLines(lines: Line[]): string {
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function textDisplay(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(truncate(content, TEXT_LIMIT));
}

/**
 * Fluent wrapper around ContainerBuilder that gives every card the same
 * structure: header → body blocks → dividers → actions → footer.
 */
export class Card {
  private readonly container = new ContainerBuilder();

  constructor(accent?: number) {
    if (accent !== undefined) this.container.setAccentColor(accent);
  }

  /** Large title with an optional subtitle line and thumbnail on the right. */
  header(title: string, options: { subtitle?: Line; thumbnail?: string | null } = {}): this {
    return this.block([`## ${title}`, options.subtitle], options.thumbnail);
  }

  /** A text block. When a thumbnail is given it renders as a Section. */
  block(content: string | Line[], thumbnail?: string | null): this {
    const text = Array.isArray(content) ? joinLines(content) : content;
    if (!text) return this;

    if (thumbnail) {
      this.container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(textDisplay(text))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail))
      );
    } else {
      this.container.addTextDisplayComponents(textDisplay(text));
    }
    return this;
  }

  text(...lines: Line[]): this {
    return this.block(lines);
  }

  /** Key/value list rendered as `**Label:** value` lines. */
  fields(fields: Array<readonly [string, string] | false | null | undefined>): this {
    const lines = fields
      .filter((field): field is readonly [string, string] => Array.isArray(field))
      .map(([label, value]) => `**${label}:** ${value}`);
    return this.block(lines);
  }

  /** Text block with a button aligned to the right. */
  withButton(content: string | Line[], button: ButtonBuilder): this {
    const text = Array.isArray(content) ? joinLines(content) : content;
    this.container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(textDisplay(text)).setButtonAccessory(button)
    );
    return this;
  }

  divider(options: { large?: boolean; visible?: boolean } = {}): this {
    this.container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(options.visible ?? true)
        .setSpacing(options.large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small)
    );
    return this;
  }

  /** Invisible spacing, useful before a footer. */
  spacer(): this {
    return this.divider({ visible: false });
  }

  actions(...buttons: ButtonBuilder[]): this {
    if (buttons.length === 0) return this;
    this.container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
    return this;
  }

  selectMenu(menu: StringSelectMenuBuilder): this {
    this.container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
    return this;
  }

  /** Small muted text lines (`-#` subtext). */
  footer(...lines: Line[]): this {
    const text = joinLines(lines.map((line) => (line ? `-# ${line}` : line)));
    return this.block(text);
  }

  build(): ContainerBuilder {
    return this.container;
  }
}

export type NoticeKind = "success" | "error" | "warning" | "info";

const noticeStyle: Record<NoticeKind, { color: number; icon: string }> = {
  success: { color: Colors.success, icon: Icons.success },
  error: { color: Colors.danger, icon: Icons.error },
  warning: { color: Colors.warning, icon: Icons.warning },
  info: { color: Colors.info, icon: Icons.info }
};

/** Compact single-purpose card used for command feedback. */
export function notice(kind: NoticeKind, title: string, description?: string | Line[]): ContainerBuilder {
  const style = noticeStyle[kind];
  const body = Array.isArray(description) ? joinLines(description) : description;
  return new Card(style.color).text(`### ${style.icon} ${title}`, body).build();
}

export const success = (title: string, description?: string | Line[]) => notice("success", title, description);
export const failure = (description: string | Line[], title = "Something went wrong") =>
  notice("error", title, description);
export const warning = (title: string, description?: string | Line[]) => notice("warning", title, description);
export const info = (title: string, description?: string | Line[]) => notice("info", title, description);

/** Usage hint shown when a prefix command gets bad arguments. */
export function usage(...examples: string[]): ContainerBuilder {
  return notice("warning", "Invalid usage", examples.map((example) => `\`${example}\``));
}

/** Mentions render as names but never ping unless explicitly allowed. */
export const NO_MENTIONS: MessageMentionOptions = { parse: [], repliedUser: false };

/** Build a Components V2 message payload. */
export function v2(components: V2Component[], allowedMentions: MessageMentionOptions = NO_MENTIONS) {
  return {
    components,
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions
  };
}

export function timestamp(date: Date | number, style: "R" | "f" | "F" | "t" | "d" = "R"): string {
  const ms = typeof date === "number" ? date : date.getTime();
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
