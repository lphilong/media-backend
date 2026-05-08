import { ContextType } from "@core/context/context.types";

export abstract class Presenter<I, O> {
  abstract present(input: I, context: ContextType): O;
}
