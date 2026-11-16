import type { ComponentType } from "react";
import type { GraphicName } from "../catalog";
import { Callout } from "./Callout";
import { Counter } from "./Counter";
import { Emoji } from "./Emoji";
import { Flash } from "./Flash";
import { Highlight } from "./Highlight";
import { LowerThird } from "./LowerThird";
import { ProgressBar } from "./ProgressBar";
import { ScreenshotShowcase } from "./ScreenshotShowcase";
import { TextPop } from "./TextPop";
import { Title } from "./Title";
import { Whip } from "./Whip";

/** A graphic receives props already parsed by its catalog schema, plus its duration in frames. */
export type AnyGraphic = ComponentType<Record<string, unknown> & { duration: number }>;

const g = (c: unknown) => c as AnyGraphic;

/** Name → component for `graphic` clips. Captions is drawn by `captions` clips. */
export const graphics: Partial<Record<GraphicName, AnyGraphic>> = {
  Title: g(Title),
  TextPop: g(TextPop),
  LowerThird: g(LowerThird),
  Callout: g(Callout),
  Highlight: g(Highlight),
  Counter: g(Counter),
  Emoji: g(Emoji),
  ProgressBar: g(ProgressBar),
  Flash: g(Flash),
  Whip: g(Whip),
  ScreenshotShowcase: g(ScreenshotShowcase),
};
