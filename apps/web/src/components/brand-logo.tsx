import Image from "next/image";
import logo from "@/assets/logo.png";

/** The Product Velocity icon. Decorative: the name next to it carries the meaning. */
export function BrandLogo({ size = 26 }: { size?: number }) {
  return <Image src={logo} alt="" width={size} height={size} className="brand-logo" priority />;
}
