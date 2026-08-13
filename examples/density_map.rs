use std::io::{self, Write};

use minetacs::Gradient;

const CENTER_DENSITY: i32 = Gradient::DENOMINATOR * 35 / 100;
const DENSITY_STEP: i32 = Gradient::DENOMINATOR / 16;

const HTML_HEAD: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mine density map</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { min-height: 100vh; margin: 0; background: #0d131d; color: #e6edf6; }
.page { display: grid; align-content: center; width: min(680px, 100%); min-height: 100vh; margin: auto; padding: 16px 20px; }
h1 { margin: 0 0 16px 27px; font-size: 28px; line-height: 1; }
.map { display: grid; grid-template-columns: 24px repeat(8, 1fr); gap: 3px; }
.axis { display: grid; place-items: center; min-width: 0; color: #718298; font: 700 12px/1 ui-monospace, monospace; }
.corner { color: #526176; }
.cell { display: grid; place-content: center; min-width: 0; aspect-ratio: 1; border: 1px solid #ffffff18; text-align: center; box-shadow: inset 0 1px #ffffff18; }
.percent { font-size: clamp(11px, 2.2vw, 17px); font-weight: 800; text-shadow: 0 1px 3px #0009; }
@media (max-width: 650px) {
	.page { padding: 8px; }
	h1 { margin-left: 21px; font-size: 22px; }
	.map { grid-template-columns: 18px repeat(8, 1fr); gap: 2px; }
}
</style>
</head>
<body>
<main class="page">
<h1>Mine density map</h1>
"#;

fn main() -> io::Result<()> {
	let mut rng = urandom::new();
	let gradient = Gradient::random(&mut rng, CENTER_DENSITY, DENSITY_STEP);

	let stdout = io::stdout();
	let mut out = io::BufWriter::new(stdout.lock());
	out.write_all(HTML_HEAD.as_bytes())?;
	writeln!(out, "<div class=\"map\" role=\"img\" aria-label=\"Eight by eight mine-density heat map\">")?;
	writeln!(out, "<div class=\"axis corner\">y\\x</div>")?;
	for x in 0..8 {
		writeln!(out, "<div class=\"axis\">{x}</div>")?;
	}
	for y in 0..8 {
		writeln!(out, "<div class=\"axis\">{y}</div>")?;
		for x in 0..8 {
			let density = gradient.density_at(x, y);
			let probability = density as f64 / Gradient::DENOMINATOR as f64;
			let red = 20.0 + probability * 219.0;
			let green = 47.0 + probability * 35.0;
			let blue = 78.0 - probability * 6.0;
			writeln!(
				out,
				"<div class=\"cell\" style=\"background:rgb({red:.0} {green:.0} {blue:.0})\" title=\"Cell ({x}, {y}): {:.2}%\"><span class=\"percent\">{:.1}%</span></div>",
				probability * 100.0,
				probability * 100.0,
			)?;
		}
	}
	writeln!(out, "</div>")?;
	out.write_all(b"</main>\n</body>\n</html>\n")?;
	Ok(())
}
