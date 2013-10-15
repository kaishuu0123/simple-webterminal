# -*- coding: utf-8 -*-
require 'rubygems'
require './ws-server.rb'
require './http-server.rb'

map '/' do
  run SinatraApp
end

map '/terminal' do
  run TerminalApp.new
end
