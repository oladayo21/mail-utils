/**
 * Core types shared across the addressing, parsing, threading, and
 * composition modules. Currently exports {@link EmailAddress}.
 *
 * @module
 */

/**
 * A single email mailbox.
 *
 * `address` is the `local@domain` part; `name` is the optional display name.
 * Fields are `readonly` — this type is treated as a value, never mutated in
 * place. Use {@link parseAddress} or {@link parseAddressList} to obtain
 * instances from a header string; use {@link formatAddress} to serialize.
 */
export type EmailAddress = {
  readonly name?: string;
  readonly address: string;
};
