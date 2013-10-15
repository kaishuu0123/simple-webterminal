require 'sinatra'

class SinatraApp < Sinatra::Application
  get '/' do
    erb :index
  end
end
