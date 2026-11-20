require 'json'

root = ARGV.fetch(0)
package = File.join(root,'package.json')
meta = JSON.parse(File.read(package))
raise 'Expected published baseline 1.1.7' unless meta.fetch('version')=='1.1.7'

renderer = Dir.glob(File.join(root,'dist/renderer/assets/index-*.js')).fetch(0)
code = File.read(renderer)
def replace_once(code, before, after)
  raise "Missing unique anchor: #{before}" unless code.scan(before).length == 1
  code.sub!(before) {after}
end

label = File.read(File.join(__dir__,'process-labels.cjs'))
function = label[/function diagnosticProcessName.*?^}/m] or raise 'Missing label function'
anchor = 'e.process.toLowerCase().includes(c)'
replace_once(code, anchor, anchor+'||diagnosticProcessName(e.process).toLowerCase().includes(c)')
replace_once(code, 'e.process||`—`,e.self', 'diagnosticProcessName(e.process)||`—`,e.self')
code << "\n" << function << "\n"
File.write(renderer,code)
meta['version']='1.1.8'
File.write(package,JSON.pretty_generate(meta)+"\n")
