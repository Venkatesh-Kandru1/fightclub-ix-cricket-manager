using Fightclub.Api;
using Fightclub.Api.Models;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);

var configuredOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];

builder.Services.AddCors(options => options.AddPolicy("frontend", policy =>
    policy.WithOrigins(configuredOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddSignalR();
builder.Services.AddSingleton<RosterStore>();

var app = builder.Build();
app.UseCors("frontend");

var adminEmail = builder.Configuration["DemoAdmin:Email"] ?? string.Empty;
var adminPassword = builder.Configuration["DemoAdmin:Password"] ?? string.Empty;
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

public sealed class RosterStore
{
    private readonly List<Player> _players =
    [
        new(1, "Arjun Mehta", "AM", ["Batsman"], "arjun@fightclubix.local", "+1 416 555 0101", 482, 0, 8, "Available", "2024-03-12"),
        new(2, "Rohan Patel", "RP", ["Batsman", "Wicket-keeper"], "rohan@fightclubix.local", "+1 416 555 0102", 366, 0, 12, "Available", "2024-03-12"),
        new(3, "Vikram Singh", "VS", ["Batsman"], "vikram@fightclubix.local", "+1 416 555 0103", 298, 0, 6, "Available", "2024-04-02"),
        new(4, "Kabir Shah", "KS", ["Batsman"], "kabir@fightclubix.local", "+1 416 555 0104", 221, 0, 9, "Available", "2024-04-02"),
        new(5, "Nikhil Rao", "NR", ["Bowler"], "nikhil@fightclubix.local", "+1 416 555 0105", 44, 27, 7, "Available", "2024-05-01"),
        new(6, "Dev Malhotra", "DM", ["Bowler"], "dev@fightclubix.local", "+1 416 555 0106", 31, 21, 5, "Available", "2024-05-01"),
        new(7, "Ayaan Khan", "AK", ["Bowler"], "ayaan@fightclubix.local", "+1 416 555 0107", 18, 18, 4, "Available", "2024-05-20"),
        new(8, "Yash Desai", "YD", ["Bowler"], "yash@fightclubix.local", "+1 416 555 0108", 12, 15, 3, "Injured", "2024-05-20"),
        new(9, "Ishaan Kapoor", "IK", ["All-rounder"], "ishaan@fightclubix.local", "+1 416 555 0109", 244, 14, 11, "Available", "2024-03-12"),
        new(10, "Manav Joshi", "MJ", ["All-rounder"], "manav@fightclubix.local", "+1 416 555 0110", 186, 11, 14, "Available", "2024-04-02"),
        new(11, "Samar Roy", "SR", ["All-rounder"], "samar@fightclubix.local", "+1 416 555 0111", 149, 9, 8, "Available", "2024-06-01"),
        new(12, "Aditya Bose", "AB", ["All-rounder"], "aditya@fightclubix.local", "+1 416 555 0112", 127, 7, 10, "Available", "2024-06-01"),
        new(13, "Neil Fernandes", "NF", ["Wicket-keeper"], "neil@fightclubix.local", "+1 416 555 0113", 312, 0, 31, "Available", "2024-03-12"),
        new(14, "Karan Gill", "KG", ["Wicket-keeper"], "karan@fightclubix.local", "+1 416 555 0114", 178, 0, 24, "Available", "2024-04-02"),
        new(15, "Aarav Nair", "AN", ["Wicket-keeper", "Batsman"], "aarav@fightclubix.local", "+1 416 555 0115", 92, 0, 17, "Available", "2024-06-15"),
        new(16, "Ritvik Iyer", "RI", ["Wicket-keeper"], "ritvik@fightclubix.local", "+1 416 555 0116", 64, 0, 12, "Available", "2024-06-15"),
    ];

    public IReadOnlyList<Player> Players => _players;

    public IReadOnlyList<PreviousMatch> Matches { get; } =
    [
        new(1, "Maplewood CC", "2026-06-28", 168, 154, "Won by 14 runs", "North York Grounds"),
        new(2, "Harbour Strikers", "2026-06-21", 142, 145, "Lost by 3 runs", "Lakeside Oval"),
        new(3, "York Lions", "2026-06-14", 191, 173, "Won by 18 runs", "Eglinton Park"),
    ];

    public Player? UpdateStat(int id, string stat)
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
