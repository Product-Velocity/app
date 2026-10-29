import Image from "next/image";
import logo from "@/assets/logo-full.png";

/** The Product Velocity logo with its name. `size` is the height in px. */
export function BrandLogo({ size = 30 }: { size?: number }) {
  return <Image src={logo} alt="Product Velocity" height={size} width={Math.round((size * 300) / 105)} className="brand-logo" priority />;
}
