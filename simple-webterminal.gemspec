# coding: utf-8
lib = File.expand_path('../', __FILE__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'version'

Gem::Specification.new do |spec|
  spec.name          = "simple-webterminal"
  spec.version       = Simple::Webterminal::VERSION
  spec.authors       = ["Kouki Ooyatsu"]
  spec.email         = ["kaishuu0123@gmail.com"]
  spec.description   = %q{simple web terminal}
  spec.summary       = %q{simple web terminal}
  spec.homepage      = ""
  spec.license       = "MIT"

  spec.files         = `git ls-files`.split($/)
  spec.executables   = spec.files.grep(%r{^bin/}) { |f| File.basename(f) }
  spec.test_files    = spec.files.grep(%r{^(test|spec|features)/})
  spec.require_paths = ["lib"]

  spec.add_development_dependency "bundler", "~> 1.3"
  spec.add_development_dependency "rake"
  spec.add_dependency "rack"
  spec.add_dependency "sinatra"
  spec.add_dependency "websocket-rack"
end
