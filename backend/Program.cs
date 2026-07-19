using Fightclub.Api;
using Fightclub.Api.Models;
using Microsoft.AspNetCore.SignalR;

LoadLocalEnv();
var builder = WebApplication.CreateBuilder(args);

var configuredOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];

builder.Services.AddCors(options => options.AddPolicy("frontend", policy =>
    policy.WithOrigins(configuredOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddSignalR();
builder.Services.AddSingleton<RosterStore>();

var app = builder.Build();
app.UseCors("frontend");

var adminEmail = builder.Configuration["DemoAdmin:Email"];
var adminPassword = builder.Configuration["DemoAdmin:Password"];
if (string.IsNullOrWhiteSpace(adminEmail))
    adminEmail = Environment.GetEnvironmentVariable("FIGHTCLUB_ADMIN_EMAIL") ?? string.Empty;
if (string.IsNullOrWhiteSpace(adminPassword))
    adminPassword = Environment.GetEnvironmentVariable("FIGHTCLUB_ADMIN_PASSWORD") ?? string.Empty;
var adminPhone = "+1 (416) 555-0198";
var adminTimezone = "America/Toronto";

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", team = "Fightclub IX" }));

app.MapPost("/api/auth/login", (LoginRequest request) =>
{
    if (string.IsNullOrWhiteSpace(adminEmail) || string.IsNullOrWhiteSpace(adminPassword))
        return Results.Problem("Configure DemoAdmin:Email and DemoAdmin:Password in local user secrets before signing in.", statusCode: 500);

    if (!string.Equals(request.Email.Trim(), adminEmail.Trim(), StringComparison.OrdinalIgnoreCase)
        || request.Password != adminPassword)
        return Results.Unauthorized();

    return Results.Ok(new AdminSession("Admin", adminEmail.Trim(), "Administrator", "Fightclub IX"));
});

app.MapGet("/api/players", (RosterStore store) => Results.Ok(store.Players));
app.MapGet("/api/matches/previous", (RosterStore store) => Results.Ok(store.Matches));
app.MapGet("/api/player-logs", (RosterStore store) => Results.Ok(store.PlayerLogs));

app.MapPut("/api/player-logs/{id:int}", (int id, UpdatePlayerLogRequest request, RosterStore store) =>
{
    if (string.IsNullOrWhiteSpace(request.Password))
        return Results.BadRequest(new { message = "A player password is required." });
    if (request.Password.Length < 8)
        return Results.BadRequest(new { message = "Player passwords must be at least 8 characters." });

    var updated = store.UpdatePlayerPassword(id, request.Password.Trim());
    return updated is null ? Results.NotFound() : Results.Ok(updated);
});

app.MapPut("/api/players/{id:int}/stats", async (int id, UpdateStatRequest request, RosterStore store, IHubContext<StatsHub> hub) =>
{
    var player = store.UpdateStat(id, request.Stat);
    if (player is null) return Results.NotFound();
    await hub.Clients.All.SendAsync("playerUpdated", player);
    return Results.Ok(player);
});

app.MapGet("/api/profile", () => Results.Ok(new ProfileDetails(
    "Admin",
    adminEmail,
    adminPhone,
    adminTimezone)));

app.MapPut("/api/profile", (UpdateProfileRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Phone) || string.IsNullOrWhiteSpace(request.Timezone))
        return Results.BadRequest(new { message = "Phone number and time zone are required." });
    adminPhone = request.Phone.Trim();
    adminTimezone = request.Timezone.Trim();
    return Results.Ok(new { message = "Profile updated locally." });
});

app.MapPost("/api/profile/password", (ChangePasswordRequest request) =>
{
    if (request.CurrentPassword != adminPassword)
        return Results.BadRequest(new { message = "Current password is incorrect." });
    if (request.NewPassword.Length < 10 || !request.NewPassword.Any(char.IsUpper)
        || !request.NewPassword.Any(char.IsLower) || !request.NewPassword.Any(char.IsDigit))
        return Results.BadRequest(new { message = "New password must be at least 10 characters with upper, lower, and numeric characters." });
    if (request.NewPassword != request.ConfirmPassword)
        return Results.BadRequest(new { message = "New password and confirmation do not match." });
    adminPassword = request.NewPassword;
    return Results.Ok(new { message = "Password updated for this local demo." });
});

app.MapHub<StatsHub>("/hubs/stats");
app.Run();

static void LoadLocalEnv()
{
    var candidates = new[]
    {
        Path.Combine(Directory.GetCurrentDirectory(), ".env.local"),
        Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", ".env.local")),
    }.Distinct(StringComparer.OrdinalIgnoreCase);

    var envFile = candidates.FirstOrDefault(File.Exists);
    if (envFile is null) return;

    foreach (var rawLine in File.ReadLines(envFile))
    {
        var line = rawLine.Trim();
        if (line.Length == 0 || line.StartsWith('#')) continue;
        var separator = line.IndexOf('=');
        if (separator <= 0) continue;
        var key = line[..separator].Trim();
        var value = line[(separator + 1)..].Trim().Trim('"', '\'');
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key)))
            Environment.SetEnvironmentVariable(key, value, EnvironmentVariableTarget.Process);
    }
}

public sealed class RosterStore
{
    private readonly object _sync = new();
    // Local demo values only. Production credentials must never be stored or returned in plaintext.
    private readonly Dictionary<int, string> _playerPasswords = new();
    private readonly List<Player> _players =
    [
        new(1, "Manikanta Reddy", "MR", ["Batsman"], "manikanta.reddy@fightclubix.local", "+1 416 555 0101", 482, 0, 8, "Available", "2024-03-12"),
        new(2, "Jagadeesh", "J", ["Batsman", "Wicket-keeper"], "jagadeesh@fightclubix.local", "+1 416 555 0102", 366, 0, 12, "Available", "2024-03-12"),
        new(3, "Ravi Kiran", "RK", ["Batsman"], "ravi.kiran@fightclubix.local", "+1 416 555 0103", 298, 0, 6, "Available", "2024-04-02"),
        new(4, "Niteesh", "N", ["Batsman", "Wicket-keeper"], "niteesh@fightclubix.local", "+1 416 555 0104", 221, 0, 9, "Available", "2024-04-02"),
        new(5, "Vishal vikas", "VV", ["Batsman"], "vishal.vikas@fightclubix.local", "+1 416 555 0105", 244, 0, 7, "Available", "2024-05-01"),
        new(6, "Venkatesh", "V", ["Batsman"], "venkatesh@fightclubix.local", "+1 416 555 0106", 186, 0, 5, "Available", "2024-05-01"),
        new(7, "Karthik Balne", "KB", ["Batsman"], "karthik.balne@fightclubix.local", "+1 416 555 0107", 149, 0, 4, "Available", "2024-05-20"),
        new(8, "Yaswanth", "Y", ["Bowler"], "yaswanth@fightclubix.local", "+1 416 555 0108", 44, 27, 7, "Available", "2024-05-20"),
        new(9, "Madhu", "M", ["Bowler"], "madhu@fightclubix.local", "+1 416 555 0109", 31, 21, 5, "Available", "2024-03-12"),
        new(10, "Arsil Riaz", "AR", ["Bowler"], "arsil.riaz@fightclubix.local", "+1 416 555 0110", 18, 18, 4, "Available", "2024-04-02"),
        new(11, "Amey Nikte", "AN", ["Bowler"], "amey.nikte@fightclubix.local", "+1 416 555 0111", 12, 15, 3, "Available", "2024-06-01"),
        new(12, "Vamsi N", "VN", ["Bowler"], "vamsi.n@fightclubix.local", "+1 416 555 0112", 9, 14, 3, "Available", "2024-06-01"),
        new(13, "Prasanth", "P", ["Bowler"], "prasanth@fightclubix.local", "+1 416 555 0113", 7, 11, 2, "Available", "2024-06-15"),
        new(14, "Yenosh", "Y", ["Bowler"], "yenosh@fightclubix.local", "+1 416 555 0114", 5, 9, 2, "Available", "2024-06-15"),
        new(15, "Guru Charan", "GC", ["Batsman"], "guru.charan@fightclubix.local", "+1 416 555 0115", 112, 0, 3, "Available", "2024-06-15"),
        new(16, "Satish", "S", ["All-rounder"], "satish@fightclubix.local", "+1 416 555 0116", 128, 8, 6, "Available", "2024-06-15"),
    ];

    public RosterStore()
    {
        foreach (var player in _players)
            _playerPasswords[player.Id] = $"Fc-{Guid.NewGuid():N}"[..15];
    }

    public IReadOnlyList<Player> Players
    {
        get
        {
            lock (_sync)
                return _players.ToArray();
        }
    }

    public IReadOnlyList<PreviousMatch> Matches { get; } =
    [
        new(1, "Maplewood CC", "2026-06-28", 168, 154, "Won by 14 runs", "North York Grounds"),
        new(2, "Harbour Strikers", "2026-06-21", 142, 145, "Lost by 3 runs", "Lakeside Oval"),
        new(3, "York Lions", "2026-06-14", 191, 173, "Won by 18 runs", "Eglinton Park"),
    ];

    public IReadOnlyList<PlayerLog> PlayerLogs
    {
        get
        {
            lock (_sync)
                return _players.Select(player => new PlayerLog(player.Id, player.Name, player.Email, _playerPasswords[player.Id])).ToArray();
        }
    }

    public Player? UpdateStat(int id, string stat)
    {
        lock (_sync)
        {
            var index = _players.FindIndex(player => player.Id == id);
            if (index < 0) return null;
            var player = _players[index];
            var updated = stat.ToLowerInvariant() switch
            {
                "runs" => player with { Runs = player.Runs + 1 },
                "wickets" => player with { Wickets = player.Wickets + 1 },
                "catches" => player with { Catches = player.Catches + 1 },
                _ => player,
            };
            _players[index] = updated;
            return updated;
        }
    }

    public PlayerLog? UpdatePlayerPassword(int id, string password)
    {
        lock (_sync)
        {
            var player = _players.Find(player => player.Id == id);
            if (player is null) return null;
            _playerPasswords[id] = password;
            return new PlayerLog(player.Id, player.Name, player.Email, password);
        }
    }
}
