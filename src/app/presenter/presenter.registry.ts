import { Presenter } from "./presenter.base";
import { SystemInvariantError } from "@core/error/system-error";

type RegisteredPresenter = Presenter<unknown, unknown>;

export class PresenterRegistry {
  private readonly presenters =
    new Map<string, RegisteredPresenter>();
  private frozen = false;

  register<TI, TO>(
    key: string,
    presenter: Presenter<TI, TO>,
  ): void {
    if (this.frozen) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `PresenterRegistry is frozen. Cannot register presenter: ${key}`,
      );
    }

    if (this.presenters.has(key)) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Presenter already registered for key: ${key}`,
      );
    }

    this.presenters.set(
      key,
      presenter as RegisteredPresenter,
    );
  }

  freeze(): void {
    if (this.frozen) return;

    if (this.presenters.size === 0) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Cannot freeze PresenterRegistry with no registered presenters",
      );
    }

    this.frozen = true;
  }

  get<TI, TO>(key: string): Presenter<TI, TO> {
    const presenter = this.presenters.get(key);

    if (!presenter) {
      throw new SystemInvariantError(
        "PRESENTER_NOT_REGISTERED",
        `Presenter not registered for key: ${key}`,
      );
    }

    return presenter as Presenter<TI, TO>;
  }
}
