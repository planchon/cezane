import type { ComponentType } from "react";
import type { GraphicName } from "../catalog";
import { BigText } from "./BigText";
import { Counter } from "./Counter";
import { Cursor } from "./Cursor";
import { Emoji } from "./Emoji";
import { Flash } from "./Flash";
import { Highlight } from "./Highlight";
import { Plate } from "./Plate";
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
  BigText: g(BigText),
  TextPop: g(TextPop),
  Cursor: g(Cursor),
  Callout: g(Cursor),
  Highlight: g(Highlight),
  Counter: g(Counter),
  Emoji: g(Emoji),
  Plate: g(Plate),
  ProgressBar: g(ProgressBar),
  Flash: g(Flash),
  Whip: g(Whip),
  ScreenshotShowcase: g(ScreenshotShowcase),
};
