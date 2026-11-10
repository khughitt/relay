// Test-only parser process: its caller supplies an isolated environment for the native compiler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
// package-lock.json pins these unstable development APIs to TypeScript 7.0.2.
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { SyntaxKind as K } from 'typescript/unstable/ast';

const sources = JSON.parse(readFileSync(0, 'utf8'));
const config = '/inbox-boundary/tsconfig.json';
const files = sources.map((source, i) => `/inbox-boundary/input-${i}.js`);
const fs = createVirtualFileSystem({
  [config]: JSON.stringify({ compilerOptions: { allowJs: true, noLib: true, noResolve: true, types: [] }, files }),
  ...Object.fromEntries(files.map((file, i) => [file, sources[i]])),
});
const api = new API({ cwd: '/inbox-boundary', fs });
// The pinned sync API exposes no public child wait; retain it until close is observed.
const child = api.client.channel.child;
child.ref();
const closed = once(child, 'close');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => api.close());
let result;
try {
  const snapshot = api.updateSnapshot({ openProjects: [config] });
  const program = snapshot.getProject(config).program;
  result = files.map((file) => {
    assert.deepEqual(program.getSyntacticDiagnostics(file), [], `cannot parse ${file}`);
    const imports = [], visited = new Set();
    function visit(node) {
      const key = `${node.kind}:${node.pos}:${node.end}`;
      if (visited.has(key)) return;
      visited.add(key);
      let literal;
      if ([K.ImportDeclaration, K.ExportDeclaration, K.JSDocImportTag].includes(node.kind)) literal = node.moduleSpecifier;
      if (node.kind === K.CallExpression && node.expression.kind === K.ImportKeyword) literal = node.arguments[0];
      if (node.kind === K.ImportType) literal = node.argument.literal;
      if (literal && [K.StringLiteral, K.NoSubstitutionTemplateLiteral].includes(literal.kind)) {
        // In syntactically valid JS, ImportType nodes are JSDoc; runtime import() is a CallExpression.
        const typeOnly = [K.ImportType, K.JSDocImportTag].includes(node.kind);
        imports.push({ specifier: literal.text, typeOnly });
      }
      node.forEachChild(visit);
      // RemoteNode.forEachChild omits JSDoc nodes, including @import tags.
      for (const doc of node.jsDoc ?? []) visit(doc);
    }
    visit(program.getSourceFile(file));
    return imports;
  });
} finally {
  api.close();
  await closed;
}
process.stdout.write(JSON.stringify(result));
