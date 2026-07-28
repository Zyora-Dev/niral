# Niral Backend Protocol (NBP) runner — Ruby.
#
# Executes the <server lang="ruby"> block of a .niral component and serves
# function calls over newline-delimited JSON on stdin/stdout. Ruby stdlib
# only — nothing to install.
#
#   usage: ruby runner.rb <server-module.rb>
#
# `session` is ambient inside server methods, same as Python/JS:
#     session.get("k") / session.set("k", v) / session["k"] = v

require "json"

class Session
  attr_accessor :data, :dirty

  def initialize
    @data = {}
    @dirty = false
  end

  def get(key, default = nil)
    @data.fetch(key.to_s, default)
  end

  def set(key, value)
    @data[key.to_s] = value
    @dirty = true
  end

  def delete(key)
    @data.delete(key.to_s)
    @dirty = true
  end

  def clear
    @data = {}
    @dirty = true
  end

  def [](key)
    @data[key.to_s]
  end

  def []=(key, value)
    @data[key.to_s] = value
    @dirty = true
  end
end

$niral_session = Session.new

# user code evaluates onto a host object: `def name` becomes a singleton
# method; bare `session` resolves to the ambient session, `publish` fans
# out to a live channel (out-of-band NBP line).
host = Object.new
def host.session
  $niral_session
end
def host.publish(channel, data = nil)
  $stdout.puts(JSON.generate({ "publish" => { "channel" => channel.to_s, "data" => data } }))
  $stdout.flush
end
def host.user
  $niral_session.get("user")
end
host.instance_eval(File.read(ARGV[0]), ARGV[0])

$stdout.sync = true
$stdin.each_line do |line|
  line = line.strip
  next if line.empty?

  begin
    req = JSON.parse(line)
  rescue JSON::ParserError
    next
  end

  out = { "id" => req["id"] }
  fn = (req["fn"] || "").to_s

  if fn.start_with?("_") || !host.respond_to?(fn)
    out.merge!("ok" => false, "error" => "unknown server function '#{fn}'", "errorKind" => "unknown_fn")
  else
    $niral_session.data = req["session"] || {}
    $niral_session.dirty = false
    begin
      args = req["args"] || []
      result = host.public_send(fn, *args)
      out.merge!("ok" => true, "result" => result,
                 "session" => ($niral_session.dirty ? $niral_session.data : nil))
    rescue => e
      out.merge!("ok" => false, "error" => e.message,
                 "session" => ($niral_session.dirty ? $niral_session.data : nil))
    end
  end

  begin
    puts JSON.generate(out)
  rescue JSON::GeneratorError => e
    puts JSON.generate({ "id" => req["id"], "ok" => false,
                         "error" => "result is not JSON-serializable: #{e.message}" })
  end
end
