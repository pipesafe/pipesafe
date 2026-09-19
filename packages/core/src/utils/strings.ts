/**
 * String-level type utilities: dollar prefixing, dotted-path joining, array
 * index strings, and the character unions backing `NoDollarString`.
 */

export type DollarPrefixed<T extends string> = `$${T}`;
export type WithoutDollar<T extends string> =
  T extends `$${infer U}` ? U : never;

export type Join<K extends string, P extends string> =
  P extends "" ? K : `${K}.${P}`;

type IsTuple<A extends unknown[]> = number extends A["length"] ? false : true;
type TupleIndex<A extends unknown[]> = Exclude<keyof A, keyof any[]>;
export type IndexStr<A extends unknown[]> =
  IsTuple<A> extends true ? `${TupleIndex<A> & number}` : `${number}`;

// Define alphanumeric characters
export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type LowerAlphabet =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
export type UpperAlphabet = Uppercase<LowerAlphabet>;
export type Alphabet = LowerAlphabet | UpperAlphabet;
export type NoDollarString = `${Alphabet | Digit}${string}` & {};
