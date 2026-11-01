"""生成完全合成的预览样例，不读取任何用户文件。"""
import pathlib
import struct
import zipfile
import zlib

root = pathlib.Path(__file__).parent / "fixtures" / "preview"
root.mkdir(parents=True, exist_ok=True)

def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

pixels = b"".join(b"\x00" + b"".join(bytes((52, 102, 73, 255)) if (x // 8 + y // 8) % 2 else bytes((240, 241, 236, 255)) for x in range(64)) for y in range(32))
(root / "sample.png").write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 32, 8, 6, 0, 0, 0)) + png_chunk(b"IDAT", zlib.compress(pixels)) + png_chunk(b"IEND", b""))
(root / "sample.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#346649"/><text x="15" y="55" fill="white" font-size="20">SVG PREVIEW OK</text><script>alert(1)</script></svg>', encoding="utf8")
(root / "sample.html").write_text('<!doctype html><meta charset="utf-8"><title>HTML fixture</title><style>body{font:16px sans-serif;padding:20px;background:#fff;color:#252622}</style><h1>HTML PREVIEW OK</h1><p>合成网页：脚本默认不能运行。</p><script>alert(1);document.body.dataset.scriptRan="yes";try{parent.document.body.dataset.previewEscaped="yes"}catch(e){document.body.dataset.isolated="yes"}</script>', encoding="utf8")
(root / "sample.md").write_text('''# Markdown 预览验收

这是合成样例，不含私人内容。

![相对路径图片](./sample.png)

```mermaid
flowchart LR
  A[读取文件] --> B[只读预览]
```

行内公式：$E=mc^2$。

$$
\\frac{1}{2}+\\frac{1}{2}=1
$$

```typescript
const message: string = "hello preview";
console.log(message);
```

| 项目 | 数值 |
| --- | --- |
| 合成数据 | 42 |
''', encoding="utf8")
(root / "notes.md").write_text("# 自动刷新验收\n\n这是修改前的内容。\n", encoding="utf8")
(root / "sample.py").write_text('message = "CODE PREVIEW OK"\nprint(message)\n# <img src=x onerror=alert(1)> 这里只是文本\n', encoding="utf8")
(root / "sample.csv").write_text('名字,数量,备注\n合成样例,42,"带逗号,仍在同一格"\n第二行,7,只读预览\n', encoding="utf8")
(root / "sample.tsv").write_text("名字\t数量\nTSV 合成样例\t12\n", encoding="utf8")
(root / "sample.bin").write_bytes(b"SYNTHETIC\x00BINARY\x01\x02\xff")
# MPEG-1 Layer III：128kb/s，44.1kHz，24 个有效零频谱静音帧；无第三方录音。
(root / "sample.mp3").write_bytes((bytes.fromhex("fffb9000") + bytes(413)) * 24)

stream = b"BT /F1 18 Tf 30 150 Td (PDF PREVIEW OK) Tj ET\n"
objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream"]
pdf = b"%PDF-1.4\n"; positions = [0]
for index, value in enumerate(objects, 1):
    positions.append(len(pdf)); pdf += f"{index} 0 obj\n".encode() + value + b"\nendobj\n"
xref = len(pdf); pdf += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{offset:010d} 00000 n \n".encode() for offset in positions[1:])
pdf += f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
(root / "sample.pdf").write_bytes(pdf)

def archive(name, files):
    with zipfile.ZipFile(root / name, "w", zipfile.ZIP_DEFLATED) as zip:
        for path, text in files.items():
            entry = zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0)); entry.compress_type = zipfile.ZIP_DEFLATED
            zip.writestr(entry, text.encode("utf8"))

rels_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
content_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
archive("sample.docx", {
    "[Content_Types].xml": f'<Types xmlns="{content_ns}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels": f'<Relationships xmlns="{rels_ns}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Word 预览验收</w:t></w:r></w:p><w:p><w:r><w:t>这是合成文档，不含私人内容。</w:t></w:r></w:p><w:p><w:hyperlink r:id="badLink"><w:r><w:t>危险链接不应运行</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>格式</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>内容</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>docx</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>只读表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>',
    "word/styles.xml": '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>',
    "word/_rels/document.xml.rels": f'<Relationships xmlns="{rels_ns}"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="badLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>',
})
archive("sample.pptx", {
    "[Content_Types].xml": f'<Types xmlns="{content_ns}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    "_rels/.rels": f'<Relationships xmlns="{rels_ns}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    "ppt/presentation.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels": f'<Relationships xmlns="{rels_ns}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    "ppt/slides/slide1.xml": '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>PPTX SYNTHETIC FIXTURE</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
})
print("合成 PNG/SVG/HTML/MD/代码/CSV/TSV/PDF/DOCX/PPTX/MP3/二进制样例已生成")
